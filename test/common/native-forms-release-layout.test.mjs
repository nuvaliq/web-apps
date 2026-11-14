import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('build/common.json'));
const rules = manifest['apps-common'].copy.scripts.files;
const formsRoot = 'apps/common/forms/lib';
const mainRoot = 'apps/common/main/lib';
const deployedApps = 'deploy/web-apps/apps/';
const normalize = value => path.posix.normalize(value);
const sourceRoot = rule => normalize('build/' + rule.cwd);

function filesUnder(directory) {
    const files = [];
    for (const item of readdirSync(new URL(directory + '/', root), { withFileTypes: true })) {
        const relative = directory + '/' + item.name;
        if (item.isDirectory()) files.push(...filesUnder(relative));
        else files.push(relative);
    }
    return files;
}

// Expand the actual release copy rules without writing a deploy tree or running Grunt.
function releaseFiles() {
    const deployed = new Map();
    for (const rule of rules.filter(rule => [formsRoot, mainRoot].includes(sourceRoot(rule)))) {
        assert.equal(rule.expand, true, 'release library copy expands relative source paths');
        assert.ok(Array.isArray(rule.src), 'library copy has an explicit artifact selection');
        const selectedExtensions = rule.src.map(pattern => {
            assert.match(pattern, /^\*\*\/\*\.(js|template)$/, 'supported release library artifact glob');
            return pattern.slice('**/*'.length);
        });
        const directory = sourceRoot(rule);
        for (const source of filesUnder(directory)) {
            if (!selectedExtensions.some(extension => source.endsWith(extension))) continue;
            const relative = source.slice(directory.length + 1);
            const destination = normalize('build/' + rule.dest + '/' + relative);
            deployed.set(destination, source);
        }
    }
    return deployed;
}

test('native forms and main libraries retain separate release destinations', () => {
    const forms = rules.filter(rule => sourceRoot(rule) === formsRoot);
    const main = rules.filter(rule => sourceRoot(rule) === mainRoot);
    assert.equal(forms.length, 1, 'one forms library release rule');
    assert.equal(main.length, 1, 'one main library release rule');
    assert.equal(normalize('build/' + forms[0].dest), deployedApps + 'common/forms/lib');
    assert.equal(normalize('build/' + main[0].dest), deployedApps + 'common/main/lib');
    assert.notEqual(forms[0].dest, main[0].dest, 'forms must not be delivered into main');
});

test('native forms AMD prerequisites resolve to their original modules in the release', () => {
    const deployed = releaseFiles();
    const consumers = [
        'apps/documenteditor/forms/app.js',
        'apps/documenteditor/forms/app/controller/ApplicationController.js'
    ];
    const prerequisites = new Set();
    for (const consumer of consumers) {
        const modules = [...read(consumer).matchAll(/['"](common\/forms\/lib\/[^'"]+)['"]/g)]
            .map(match => match[1]);
        assert.ok(modules.includes('common/forms/lib/view/modals'), 'native forms consumes its own modals module');
        for (const module of modules) prerequisites.add(module);
    }
    for (const module of prerequisites) {
        assert.equal(deployed.get(deployedApps + module + '.js'), 'apps/' + module + '.js',
            'native forms prerequisite must resolve at the URL requested by RequireJS');
    }
    for (const source of filesUnder(formsRoot).filter(file => /\.(js|template)$/.test(file))) {
        const modulePath = source.slice('apps/'.length);
        assert.equal(deployed.get(deployedApps + modulePath), source,
            'each selected forms artifact retains its namespace in the release');
    }
});

test('main library delivery remains intact beside native forms', () => {
    const deployed = releaseFiles();
    const base = 'common/main/lib/component/BaseView.js';
    assert.equal(deployed.get(deployedApps + base), 'apps/' + base);
    for (const [destination, source] of deployed) {
        if (source.startsWith(formsRoot + '/')) {
            assert.ok(!destination.startsWith(deployedApps + 'common/main/lib/'),
                'forms artifacts may not occupy the main library namespace');
        }
    }
});
