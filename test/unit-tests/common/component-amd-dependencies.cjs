#!/usr/bin/env node
/* Run: AMD_BASELINE_REV=<revision> AMD_EVIDENCE_DIR=<directory> node test/unit-tests/common/component-amd-dependencies.cjs --original-only
 * Omit --original-only after declaring the production dependencies to compare both snapshots.
 * AMD_BASELINE_REV names a revision where the listed modules still do not declare BaseView. The original snapshot
 * is the current tracked tree with only those module files taken from that revision.
 * PLAYWRIGHT_MODULE and CHROMIUM_PATH select an existing browser installation.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {once} = require('node:events');
const root = path.resolve(__dirname, '../../..');
const baseView = 'common/main/lib/component/BaseView';
/* Each factory reads only Common.UI.BaseView from other modules while it runs; instances use other services later.
 * Editor views assign into their application namespace and the file menu panels read the SDK file type
 * enumeration; both exist before the postload bundle runs and are provided as empty preconditions. */
const amdModule = (name, id, constructorPath, extra = {}) => ({name, id, path: constructorPath,
    file: id.split('/').pop(),
    owners: [baseView], last: [baseView], deps: [baseView], resources: [], ...extra});
const components = [
    ...['AceEditor', 'ColorPaletteExt', 'ComboBoxDataView', 'HSBColorPicker', 'MaskedField', 'MonacoEditor',
        'TableStyler', 'TextareaField'].map(name => amdModule(name, `common/main/lib/component/${name}`,
            ['Common', 'UI', name])),
    amdModule('PluginPanel', 'common/main/lib/view/PluginPanel', ['Common', 'Views', 'PluginPanel']),
    ...[['documenteditor', 'DE'], ['presentationeditor', 'PE'], ['spreadsheeteditor', 'SSE'], ['pdfeditor', 'PDFE'],
        ['visioeditor', 'VE']].map(([editor, app]) => amdModule(`${app}-FileMenuPanels`,
        `${editor}/main/app/view/FileMenuPanels`, [app, 'Views', 'FileMenuPanels', 'ViewSaveAs'])),
    amdModule('SSE-Spellcheck', 'spreadsheeteditor/main/app/view/Spellcheck', ['SSE', 'Views', 'Spellcheck']),
    amdModule('PDFE-FormsTab', 'pdfeditor/main/app/view/FormsTab', ['PDFE', 'Views', 'FormsTab']),
    amdModule('PDFE-FormSettings', 'pdfeditor/main/app/view/FormSettings', ['PDFE', 'Views', 'FormSettings'], {
        deps: ['text!pdfeditor/main/app/template/FormSettings.template', baseView],
        resources: ['vendor/requirejs-text/text.js', 'apps/pdfeditor/main/app/template/FormSettings.template']})
];
const componentFiles = components.map(component => `apps/${component.id}.js`);
const applications = ['DE', 'PE', 'SSE', 'PDFE', 'VE'];
/* Only the runtime trees are served; build configuration and tests may differ from the baseline. */
const runtimeTrees = ['apps', 'vendor'];
const harnessFile = 'test/unit-tests/common/component-amd-dependencies.cjs';
const loaderFile = 'vendor/requirejs/require.js';
const appFile = 'apps/documenteditor/main/app.js';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function readConfig(snapshot) {
    const stop = {};
    let config;
    const require = function () { throw new Error('Application startup must not run'); };
    require.config = value => { config = value; throw stop; };
    try {
        vm.runInNewContext(fs.readFileSync(path.join(snapshot, appFile), 'utf8'), {require}, {timeout: 1000});
    } catch (error) {
        if (error !== stop) throw error;
    }
    assert.ok(config && config.paths && config.shim, 'Missing production RequireJS configuration');
    return JSON.parse(JSON.stringify({paths: config.paths, shim: config.shim}));
}

function fileEntry(directory, file) {
    const target = path.join(directory, file);
    const stat = fs.lstatSync(target);
    assert.ok(stat.isFile() || stat.isSymbolicLink(), `Unsupported tracked entry: ${file}`);
    const bytes = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(target)) : fs.readFileSync(target);
    return {sha256: sha256(bytes), size: bytes.length, symlink: stat.isSymbolicLink()};
}

async function snapshots(evidence, revision, originalOnly) {
    const directory = path.join(evidence, 'snapshots');
    fs.mkdirSync(directory);
    const original = path.join(directory, 'original');
    fs.mkdirSync(original);
    const resolved = git(['rev-parse', '--verify', `${revision}^{commit}`]).trim();
    const before = {head: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--porcelain=v1']),
        diff: git(['diff', '--no-ext-diff', 'HEAD', '--']), index: git(['diff', '--cached', '--no-ext-diff'])};
    const tracked = git(['ls-files', '-z', '--', ...runtimeTrees]).split('\0').filter(Boolean);
    assert.ok(componentFiles.every(file => tracked.includes(file)), 'A tested module is not tracked');
    const copyTracked = destinationRoot => {
        const copied = {};
        for (const file of tracked) {
            const source = path.join(root, file);
            const destination = path.join(destinationRoot, file);
            const entry = fileEntry(root, file);
            fs.mkdirSync(path.dirname(destination), {recursive: true});
            if (entry.symlink) fs.symlinkSync(fs.readlinkSync(source), destination);
            else fs.copyFileSync(source, destination);
            copied[file] = fileEntry(destinationRoot, file);
            assert.deepEqual(copied[file], entry, `Snapshot changed while copying: ${file}`);
        }
        return copied;
    };
    copyTracked(original);
    for (const file of componentFiles) {
        fs.writeFileSync(path.join(original, file), execFileSync('git', ['show', `${resolved}:${file}`],
            {cwd: root, maxBuffer: 64 * 1024 * 1024}));
    }
    const entries = {};
    for (const file of tracked) entries[file] = fileEntry(original, file);
    const manifest = {baseline: resolved, baselineFiles: componentFiles, target: before, files: {original: entries},
        changed: []};
    const result = {original};
    {
        const corrected = path.join(directory, 'tracked-candidate');
        fs.mkdirSync(corrected);
        const correctedEntries = copyTracked(corrected);
        for (const file of tracked) {
            if (correctedEntries[file].sha256 !== entries[file].sha256) manifest.changed.push(file);
        }
        manifest.harness = fileEntry(root, harnessFile);
        assert.ok(manifest.changed.every(file => componentFiles.includes(file)),
            'A dependency outside the tested production modules differs');
        manifest.files.corrected = correctedEntries;
        manifest.candidate = {directory: 'tracked-candidate', tested: !originalOnly,
            changed: manifest.changed.length, correctedClaim: !originalOnly};
        if (!originalOnly) result.corrected = corrected;
    }
    assert.equal(git(['rev-parse', 'HEAD']).trim(), before.head);
    assert.equal(git(['status', '--porcelain=v1']), before.status, 'Target changed during snapshot');
    assert.equal(git(['diff', '--no-ext-diff', 'HEAD', '--']), before.diff);
    assert.equal(git(['diff', '--cached', '--no-ext-diff']), before.index);
    for (const component of components) {
        const source = fs.readFileSync(path.join(original, `apps/${component.id}.js`), 'utf8');
        assert.ok(!source.includes(`'${baseView}'`), `Baseline is already changed: ${component.name}`);
    }
    writeJSON(path.join(evidence, 'manifest.json'), manifest);
    return {directories: result, manifest};
}

function resourceFile(id, config) {
    const prefix = Object.keys(config.paths).sort((a, b) => b.length - a.length)
        .find(key => id === key || id.startsWith(key + '/'));
    const mapped = prefix ? config.paths[prefix] + id.slice(prefix.length) : id;
    assert.equal(typeof mapped, 'string', 'Path fallbacks need an explicit resource inventory');
    const file = path.posix.normalize(`apps/${mapped}.js`);
    assert.ok(!file.startsWith('../') && !file.includes('://'), 'Only snapshot resources are allowed');
    return file;
}

async function serve(directories) {
    const log = [];
    const server = http.createServer((request, response) => {
        let pathname;
        try {
            const url = new URL(request.url, 'http://127.0.0.1');
            assert.equal(url.search, '');
            pathname = decodeURIComponent(url.pathname);
            const parts = pathname.split('/').filter(Boolean);
            const variant = parts.shift();
            const directory = directories[variant];
            assert.ok(directory && parts.length && !parts.includes('..'));
            const relative = parts.join('/');
            if (relative === 'document.html') {
                const body = Buffer.from('<!doctype html><html><head><meta charset="utf-8">' +
                    '<link rel="icon" href="data:,"></head><body></body></html>');
                response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length,
                    'Cache-Control': 'no-store'});
                log.push({sequence: log.length, method: request.method, path: pathname, status: 200, document: true});
                response.end(body);
                return;
            }
            const file = path.resolve(directory, relative);
            const real = fs.realpathSync(file);
            assert.ok(real.startsWith(directory + path.sep), 'Resource escapes snapshot');
            const bytes = fs.readFileSync(real);
            const hash = sha256(bytes);
            assert.equal(request.method, 'GET');
            response.writeHead(200, {'Content-Type': relative.endsWith('.js') ? 'application/javascript' : 'text/plain',
                'Content-Length': bytes.length, ETag: `"${hash}"`, 'Cache-Control': 'public, max-age=3600',
                'X-Source-SHA256': hash});
            log.push({sequence: log.length, method: request.method, path: pathname, status: 200,
                sha256: hash, size: bytes.length});
            response.end(bytes);
        } catch (error) {
            log.push({sequence: log.length, method: request.method, path: pathname || '/', status: 404});
            response.writeHead(404, {'Cache-Control': 'no-store'});
            response.end('Missing local resource');
        }
    });
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    return {server, log, origin: `http://127.0.0.1:${server.address().port}`};
}

/* The hook changes owner dependency arrays only. The real factory object reaches vendor execCb. */
function installProbe({component, config, baseUrl, applications}) {
    const records = [];
    const definitions = {};
    const references = new Map();
    const pending = {};
    const released = [];
    const callbacks = {};
    const errors = [];
    const vendorDefine = window.define;
    const vendorRequire = window.requirejs;
    const originalAMD = vendorDefine.amd;
    let serial = 0;
    const record = (type, data = {}) => records.push({sequence: serial++, type, ...data});
    const serialize = error => ({name: error && error.name, message: String(error && error.message || error),
        stack: error && error.stack || '', requireType: error && error.requireType,
        requireModules: error && error.requireModules});
    const api = id => {
        if (id === 'common/main/lib/component/BaseView') return typeof Common.UI.BaseView === 'function' &&
            typeof Common.UI.BaseView.extend === 'function' && typeof Common.UI.getId === 'function' && !!Common.UI.Keys;
        return false;
    };
    const ownerState = () => Object.fromEntries(component.owners.map(id => [id, api(id)]));
    const constructor = () => typeof component.path.reduce((owner, key) => owner && owner[key], window);
    window.Common = {UI: {}};
    for (const application of applications) window[application] = {Views: {}};
    window.Asc = {c_oAscFileType: {}};
    window.define = function () {
        const args = Array.from(arguments);
        const named = typeof args[0] === 'string';
        const script = document.currentScript;
        const id = named ? args[0] : script && script.getAttribute('data-requiremodule');
        const depsIndex = named ? 1 : 0;
        const deps = args[depsIndex];
        const factory = args[depsIndex + 1];
        if (component.owners.includes(id) || id === component.id) {
            if (!Array.isArray(deps) || typeof factory !== 'function') {
                throw new Error('Unexpected production define signature: ' + id);
            }
            if (definitions[id]) throw new Error('Duplicate production define: ' + id);
            definitions[id] = {deps: deps.slice(), gatedDeps: deps.slice(), source: factory.toString()};
            references.set(id, factory);
            if (component.owners.includes(id)) {
                args[depsIndex] = deps.concat('scheduling-gate!' + id);
                definitions[id].gatedDeps = args[depsIndex].slice();
            }
            record('define', {id, deps: deps.slice(), gatedDeps: definitions[id].gatedDeps.slice()});
        }
        return Reflect.apply(vendorDefine, this, args);
    };
    window.define.amd = originalAMD;
    vendorDefine('scheduling-gate', [], function () {
        return {normalize: name => name, load: function (id, require, onload) {
            if (!component.owners.includes(id) || pending[id]) throw new Error('Invalid scheduling gate: ' + id);
            pending[id] = onload;
            record('gate:pending', {id});
        }};
    });
    vendorRequire.config({...config, baseUrl, waitSeconds: 15});
    const context = vendorRequire.s.contexts._;
    const vendorExecCb = context.execCb;
    context.execCb = function (id, factory, args, exports) {
        const tracked = references.has(id);
        if (tracked) record('factory:start', {id, productionReference: factory === references.get(id),
            owners: ownerState(), pending: Object.keys(pending), released: released.slice()});
        try {
            const result = Reflect.apply(vendorExecCb, this, arguments);
            if (tracked) record('factory:end', {id, api: api(id), constructor: constructor()});
            return result;
        } catch (error) {
            if (tracked) record('factory:error', {id, error: serialize(error), owners: ownerState()});
            throw error;
        }
    };
    const onError = error => { const value = serialize(error); errors.push(value); record('require:onError', {error: value}); };
    vendorRequire.onError = onError;
    const request = id => vendorRequire([id], function () {
        callbacks[id] = {success: true};
        record('require:success', {id, owners: ownerState()});
    }, function (error) {
        callbacks[id] = {success: false, error: serialize(error)};
        record('require:error', {id, error: serialize(error)});
    });
    window.amdProbe = {
        startOwners: () => component.owners.forEach(request),
        startComponent: () => { record('component:request', {pending: Object.keys(pending)}); request(component.id); },
        release: id => {
            if (!pending[id] || released.includes(id)) throw new Error('Gate is not pending: ' + id);
            released.push(id);
            record('gate:release', {id, owners: ownerState()});
            pending[id]();
        },
        observe: () => ({records: records.slice(), definitions, callbacks: {...callbacks}, errors: errors.slice(),
            pending: Object.keys(pending), released: released.slice(), owners: ownerState(),
            constructor: constructor(),
            integrity: {defineAMD: window.define.amd === originalAMD, require: window.requirejs === vendorRequire,
                execCb: context.execCb !== vendorExecCb},
            resources: performance.getEntriesByType('resource').map(entry => {
                const url = new URL(entry.name);
                return {url: url.origin === location.origin ? url.origin + url.pathname : '[nonlocal]',
                    hasQuery: !!url.search, initiatorType: entry.initiatorType, transferSize: entry.transferSize,
                    encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize};
            })})
    };
    return new Promise((resolve, reject) => vendorRequire(['backbone', 'jquery', 'underscore'], (Backbone, $, _) => {
        window._ = _;
        if (window.Backbone !== Backbone || window.$ !== $ || typeof _.template !== 'function' ||
                Object.keys(Common.UI).length || Object.keys(Common).length !== 1 ||
                !applications.every(application => Object.keys(window[application].Views).length === 0)) {
            reject(new Error('Production vendor preconditions failed'));
            return;
        }
        record('preconditions:ready', {backbone: Backbone.VERSION, jquery: $.fn.jquery, underscore: _.VERSION});
        resolve();
    }, reject));
}

function releaseOrder(component, lastOwner) {
    const order = component.owners;
    assert.ok(component.last.includes(lastOwner), 'Last owner would violate the production dependency graph');
    return [...order.filter(id => id !== lastOwner), lastOwner];
}

function cacheEvidence(urls, expected, events, timings, serverLog, mode) {
    return urls.map(url => {
        const responses = events.filter(event => event.type === 'response' && event.url === url);
        const timing = timings.filter(entry => entry.url === url);
        const requests = serverLog.filter(entry => entry.path === new URL(url).pathname && !entry.document);
        const response = responses.length === 1 && responses[0];
        const fromCache = response && (response.fromDiskCache || events.some(event =>
            event.type === 'servedFromCache' && event.requestId === response.requestId));
        const body = response && events.find(event => event.type === 'body' && event.requestId === response.requestId);
        const correctBytes = response && body && body.sha256 === expected[url].sha256 &&
            body.size === expected[url].size && response.sha256 === expected[url].sha256;
        const normal = response && response.status === 200 && !response.fromServiceWorker &&
            timing.length === 1 && !timing[0].hasQuery;
        const verified = mode === 'cold' ? normal && correctBytes && !fromCache &&
            timing[0].transferSize > timing[0].encodedBodySize && timing[0].encodedBodySize === expected[url].size &&
            requests.length === 1 && requests[0].sha256 === expected[url].sha256 :
            normal && correctBytes && !!fromCache && timing[0].transferSize === 0 &&
            timing[0].encodedBodySize === expected[url].size && requests.length === 0;
        return {url, expected: expected[url], responses, timing, serverRequests: requests,
            fromCache: !!fromCache, verified: !!verified, status: verified ? 'verified' : 'cache-unverified'};
    });
}

async function runCell(browser, serving, snapshot, manifest, component, variant, cache, lastOwner, evidence) {
    const key = [component.name, variant, cache, lastOwner.split('/').pop()].join('-');
    const directory = path.join(evidence, key);
    fs.mkdirSync(directory);
    const config = readConfig(snapshot);
    const prefix = `${serving.origin}/${variant}/`;
    const ids = ['jquery', 'underscore', 'backbone', ...component.owners, component.id];
    const files = [...new Set([loaderFile, ...ids.map(id => resourceFile(id, config)), ...component.resources])];
    const urls = files.map(file => prefix + file);
    const expected = Object.fromEntries(files.map(file => [prefix + file, manifest.files[variant][file]]));
    for (const [url, entry] of Object.entries(expected)) assert.ok(entry, `Untracked resource: ${url}`);
    const context = await browser.newContext({serviceWorkers: 'block'});
    const events = [];
    const pageErrors = [];
    const consoleErrors = [];
    const result = {component: component.name, variant, cache, lastOwner, urls, expected,
        loaderHash: manifest.files[variant][loaderFile].sha256,
        sourceHash: manifest.files[variant][`apps/${component.id}.js`].sha256,
        expectedOutcome: variant === 'original' ? 'production BaseView/extend failure' : 'wait, then constructor and require success',
        actual: 'incomplete', tests: {}, warm: []};
    let phaseStart = serving.log.length;
    let page;
    let cdp;
    try {
        page = await context.newPage();
        page.on('pageerror', error => pageErrors.push({name: error.name, message: error.message, stack: error.stack}));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
        else {
            await page.goto(prefix + 'document.html');
            result.warm = await page.evaluate(async urls => {
                const warmed = [];
                for (const url of urls) {
                    const response = await fetch(url, {cache: 'reload', credentials: 'omit'});
                    const bytes = await response.arrayBuffer();
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    warmed.push({url, status: response.status, size: bytes.byteLength,
                        sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')});
                }
                return warmed;
            }, urls);
            for (const warmed of result.warm) {
                assert.equal(warmed.status, 200);
                assert.equal(warmed.sha256, expected[warmed.url].sha256);
            }
            assert.equal(await page.evaluate(() => typeof window.requirejs), 'undefined', 'Warmup executed JavaScript');
            assert.equal(await page.evaluate(() => typeof window.Common), 'undefined', 'Warmup made owners ready');
        }
        const safeURL = value => {
            const url = new URL(value);
            return url.origin === serving.origin ? url.origin + url.pathname : '[nonlocal]';
        };
        cdp.on('Network.requestWillBeSent', event => events.push({type: 'request', requestId: event.requestId,
            url: safeURL(event.request.url), hasQuery: !!new URL(event.request.url).search,
            method: event.request.method, resourceType: event.type}));
        cdp.on('Network.requestServedFromCache', event => events.push({type: 'servedFromCache', requestId: event.requestId}));
        cdp.on('Network.responseReceived', event => {
            const response = event.response;
            events.push({type: 'response', requestId: event.requestId, url: safeURL(response.url), status: response.status,
                fromDiskCache: !!response.fromDiskCache, fromServiceWorker: !!response.fromServiceWorker,
                protocol: response.protocol, sha256: response.headers['X-Source-SHA256'] || response.headers['x-source-sha256'],
                encodedDataLength: response.encodedDataLength});
        });
        cdp.on('Network.loadingFailed', event => events.push({type: 'failed', requestId: event.requestId,
            errorText: event.errorText, blockedReason: event.blockedReason}));
        phaseStart = serving.log.length;
        await page.goto(prefix + 'document.html');
        assert.equal(await page.evaluate(() => typeof window.Common), 'undefined');
        await page.addScriptTag({url: prefix + loaderFile});
        await page.evaluate(installProbe, {component, config, baseUrl: prefix + 'apps/', applications});
        await page.evaluate(() => amdProbe.startOwners());
        await page.waitForFunction(owners => owners.every(id => amdProbe.observe().pending.includes(id)), component.owners);
        result.before = await page.evaluate(() => amdProbe.observe());
        assert.ok(component.owners.every(id => !result.before.owners[id]), 'Owner started before its gate was released');
        await page.evaluate(() => amdProbe.startComponent());
        if (variant === 'original') {
            await page.waitForFunction(id => amdProbe.observe().records.some(event =>
                event.id === id && event.type === 'factory:error'), component.id);
            const failed = await page.evaluate(() => amdProbe.observe());
            const failure = failed.records.find(event => event.id === component.id && event.type === 'factory:error');
            assert.equal(failed.constructor, 'undefined');
            assert.match(failure.error.message, /(?:undefined.*extend|extend.*undefined|BaseView)/i);
            assert.match(failure.error.stack, new RegExp(component.file + '\\.js:\\d+'));
            assert.equal(failure.owners[baseView], false);
            assert.ok(failed.callbacks[component.id] && failed.callbacks[component.id].success === false,
                'Production failure has no independent require error callback');
            assert.match(failed.callbacks[component.id].error.stack, new RegExp(component.file + '\\.js:\\d+'));
            result.productionFailure = failure.error;
        } else {
            await page.waitForFunction(id => !!amdProbe.observe().definitions[id], component.id);
            assert.equal((await page.evaluate(() => amdProbe.observe())).records.filter(event =>
                event.id === component.id && event.type === 'factory:start').length, 0);
        }
        const order = releaseOrder(component, lastOwner);
        for (const id of order) {
            if (id === lastOwner && variant === 'corrected') {
                result.beforeLast = await page.evaluate(() => amdProbe.observe());
                assert.equal(result.beforeLast.records.filter(event => event.id === component.id &&
                    event.type === 'factory:start').length, 0, 'Component did not wait for last owner');
            }
            await page.evaluate(id => amdProbe.release(id), id);
            await page.waitForFunction(id => {
                const state = amdProbe.observe();
                return state.callbacks[id] && state.callbacks[id].success && state.owners[id] &&
                    state.records.some(event => event.id === id && event.type === 'factory:end');
            }, id);
        }
        if (variant === 'corrected') await page.waitForFunction(id => {
            const state = amdProbe.observe();
            return state.callbacks[id] && state.callbacks[id].success;
        }, component.id);
        result.observation = await page.evaluate(() => amdProbe.observe());
        const state = result.observation;
        assert.equal(state.integrity.defineAMD, true);
        assert.equal(state.integrity.require, true);
        assert.equal(state.integrity.execCb, true);
        assert.ok(component.owners.every(id => state.owners[id] && state.callbacks[id].success));
        const starts = state.records.filter(event => event.type === 'factory:start');
        assert.ok(starts.length && starts.every(event => event.productionReference), 'Factory reference was replaced');
        assert.equal(starts.filter(event => event.id === component.id).length, 1);
        const request = state.records.find(event => event.type === 'component:request');
        assert.ok(component.owners.every(id => request.pending.includes(id)));
        for (const id of component.owners) {
            const definition = state.definitions[id];
            assert.deepEqual(definition.gatedDeps, definition.deps.concat('scheduling-gate!' + id));
        }
        const definition = state.definitions[component.id];
        assert.deepEqual(definition.gatedDeps, definition.deps, 'Candidate dependencies were injected');
        if (variant === 'original') {
            assert.deepEqual(definition.deps, component.deps.filter(id => id !== baseView));
            assert.equal(state.records.filter(event => event.type === 'factory:error').length, 1);
            assert.ok([...state.errors, ...pageErrors].every(error =>
                error.stack.includes(component.file + '.js:')), 'Unexpected browser or loader error');
        } else {
            assert.deepEqual(definition.deps, component.deps);
            assert.equal(state.constructor, 'function');
            assert.ok(starts.find(event => event.id === component.id).owners &&
                component.owners.every(id => starts.find(event => event.id === component.id).owners[id]));
            assert.equal(state.records.filter(event => event.id === component.id && event.type === 'factory:end').length, 1);
            assert.equal(state.records.filter(event => event.type === 'factory:error').length, 0);
            assert.deepEqual(state.errors, []);
            assert.deepEqual(pageErrors, []);
        }
        for (const response of events.filter(event => event.type === 'response' && urls.includes(event.url))) {
            const body = await cdp.send('Network.getResponseBody', {requestId: response.requestId});
            const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
            events.push({type: 'body', requestId: response.requestId, sha256: sha256(bytes), size: bytes.length});
        }
        result.cacheObservations = cacheEvidence(urls, expected, events, state.resources,
            serving.log.slice(phaseStart), cache);
        assert.ok(result.cacheObservations.every(entry => entry.verified), 'cache-unverified');
        assert.ok(!events.some(event => event.type === 'failed'), 'Network resource failure');
        assert.ok(!events.some(event => event.type === 'request' &&
            (!event.url.startsWith(serving.origin + '/') || event.hasQuery)), 'Nonlocal or parameterized network request');
        assert.ok(!serving.log.slice(phaseStart).some(entry => entry.status !== 200), 'Local resource failure');
        result.tests.factory_reference_is_production = true;
        result.tests.http_cache_is_observed_independently = true;
        result.tests.gate_does_not_replace_requirejs = true;
        if (variant === 'original') result.tests[`original_fails_before_baseview_ready_${cache}`] = true;
        result.actual = variant === 'original' ? 'expected-production-failure' : 'waited-and-succeeded';
        result.complete = true;
    } catch (error) {
        result.failure = {name: error.name, message: error.message, stack: error.stack};
        result.complete = false;
        if (page && !page.isClosed()) {
            try { result.observation = await page.evaluate(() => window.amdProbe && amdProbe.observe()); }
            catch (observationError) { result.observationError = observationError.message; }
        }
        result.actual = error.message.includes('cache-unverified') ? 'cache-unverified' : 'failed';
    } finally {
        try {
            result.pageErrors = pageErrors;
            result.consoleErrors = consoleErrors;
            result.server = serving.log.slice(phaseStart);
            writeJSON(path.join(directory, 'result.json'), result);
            writeJSON(path.join(directory, 'cdp.json'), events);
            writeJSON(path.join(directory, 'server.json'), result.server);
            writeJSON(path.join(directory, 'trace.json'), result.observation || {});
        } finally { await context.close(); }
    }
    return result;
}

async function main() {
    const originalOnly = process.argv.includes('--original-only');
    assert.ok(process.argv.slice(2).every(argument => argument === '--original-only'), 'Unknown argument');
    assert.ok(process.env.AMD_BASELINE_REV, 'Set AMD_BASELINE_REV to an immutable baseline revision');
    assert.ok(process.env.AMD_EVIDENCE_DIR, 'Set AMD_EVIDENCE_DIR outside the product tree');
    const evidenceRoot = path.resolve(process.env.AMD_EVIDENCE_DIR);
    assert.ok(evidenceRoot !== root && !evidenceRoot.startsWith(root + path.sep), 'Evidence must be outside the product tree');
    fs.mkdirSync(evidenceRoot, {recursive: true});
    const evidence = fs.mkdtempSync(path.join(evidenceRoot, 'run-'));
    let serving;
    let browser;
    const results = [];
    const summary = {originalOnly, complete: false, tests: {}};
    try {
        const {directories, manifest} = await snapshots(evidence, process.env.AMD_BASELINE_REV, originalOnly);
        serving = await serve(directories);
        const modulePath = require.resolve(process.env.PLAYWRIGHT_MODULE || 'playwright');
        const {chromium} = require(modulePath);
        const executable = process.env.CHROMIUM_PATH || chromium.executablePath();
        browser = await chromium.launch({headless: true, executablePath: executable});
        let packageDirectory = path.dirname(modulePath);
        while (!fs.existsSync(path.join(packageDirectory, 'package.json'))) {
            const parent = path.dirname(packageDirectory);
            assert.notEqual(parent, packageDirectory, 'Playwright package manifest not found');
            packageDirectory = parent;
        }
        const packageFile = path.join(packageDirectory, 'package.json');
        const packageInfo = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        writeJSON(path.join(evidence, 'environment.json'), {node: {version: process.version,
            executable: process.execPath, sha256: sha256(fs.readFileSync(process.execPath))},
            playwright: {module: modulePath, version: packageInfo.version,
                packageHash: sha256(fs.readFileSync(packageFile)), sha256: sha256(fs.readFileSync(modulePath))},
            chromium: {executable, version: browser.version(), sha256: sha256(fs.readFileSync(executable))},
            git: git(['--version']).trim(), origin: serving.origin, originalOnly});
        for (const component of components) {
            const lastOwners = originalOnly ? component.last.slice(0, 1) : component.last;
            for (const lastOwner of lastOwners) {
                for (const cache of ['cold', 'cached']) {
                    for (const [variant, snapshot] of Object.entries(directories)) {
                        const result = await runCell(browser, serving, snapshot, manifest, component,
                            variant, cache, lastOwner, evidence);
                        results.push(result);
                        console.log(`${result.complete ? 'PASS' : 'FAIL'} ${component.name} ${variant} ${cache} ${lastOwner}`);
                    }
                }
            }
        }
        if (!originalOnly) {
            for (const component of components) {
                const pair = results.filter(result => result.component === component.name &&
                    result.cache === 'cold' && result.lastOwner === component.last[0]);
                const source = pair.map(result => result.observation && result.observation.definitions[component.id]);
                assert.equal(source.length, 2);
                assert.ok(source.every(Boolean), 'Missing production factory definition');
                assert.equal(source[0].source, source[1].source, 'Production factory body changed between snapshots');
            }
        }
        assert.equal(results.length, components.length * (originalOnly ? 2 : 4));
        assert.ok(results.every(result => result.complete), 'Incomplete component/cache/owner matrix');
        for (const cache of ['cold', 'cached']) {
            const baseline = results.filter(result => result.variant === 'original' && result.cache === cache &&
                result.lastOwner === components.find(component => component.name === result.component).last[0]);
            summary.tests[`original_fails_before_baseview_ready_${cache}`] = baseline.length === components.length &&
                baseline.every(result => result.complete && result.actual === 'expected-production-failure');
        }
        for (const name of ['factory_reference_is_production', 'http_cache_is_observed_independently',
            'gate_does_not_replace_requirejs']) {
            summary.tests[name] = results.every(result => result.tests[name]);
        }
        summary.complete = true;
    } catch (error) {
        summary.failure = {name: error.name, message: error.message, stack: error.stack};
        throw error;
    } finally {
        try {
            summary.cells = results.length;
            summary.completedCells = results.filter(result => result.complete).length;
            writeJSON(path.join(evidence, 'summary.json'), summary);
            const table = ['| Component | Variant | Cache | Last owner | Outcome | Complete |',
                '| --- | --- | --- | --- | --- | --- |', ...results.map(result =>
                    `| ${result.component} | ${result.variant} | ${result.cache} | ${result.lastOwner} | ${result.actual} | ${!!result.complete} |`)];
            fs.writeFileSync(path.join(evidence, 'matrix.md'), table.join('\n') + '\n');
            writeJSON(path.join(evidence, 'matrix.json'), results);
            if (serving) writeJSON(path.join(evidence, 'server.json'), serving.log);
        } finally {
            try { if (browser) await browser.close(); }
            finally {
                if (serving) await new Promise((resolve, reject) =>
                    serving.server.close(error => error ? reject(error) : resolve()));
            }
        }
        console.log(`Evidence: ${evidence}`);
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
