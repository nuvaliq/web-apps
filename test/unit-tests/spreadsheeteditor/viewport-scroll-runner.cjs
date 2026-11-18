const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewport-scroll-runner-'));
const runner = path.resolve(__dirname, '../../e2e/spreadsheeteditor/viewport-scroll.cjs');
let failed = 0;
const cases = [
	['missing repetitions', {timeoutMs: 30000}],
	['missing repetitions in control', {timeoutMs: 30000}, 'control'],
	['nonnumeric repetitions', {repetitions: 'many', timeoutMs: 30000}],
	['string repetitions', {repetitions: '10', timeoutMs: 30000}],
	['fractional repetitions', {repetitions: 10.5, timeoutMs: 30000}],
	['too few repetitions', {repetitions: 9, timeoutMs: 30000}],
	['missing timeout', {repetitions: 10}],
	['nonnumeric timeout', {repetitions: 10, timeoutMs: 'slow'}],
	['too short timeout', {repetitions: 10, timeoutMs: 1000}],
	['null configuration', null]
];

try {
	const manifest = path.join(root, 'manifest.json');
	fs.writeFileSync(manifest, JSON.stringify({revision: 'test', assets: []}));
	for (const [index, [name, values, mode]] of cases.entries()) {
		const config = path.join(root, 'config-' + index + '.json');
		const output = path.join(root, 'output-' + index);
		fs.writeFileSync(config, JSON.stringify(values && {...values, manifestPath: manifest}));
		const child = spawnSync(process.execPath, [runner, '--config', config, '--output', output,
			'--mode', mode || 'regression'], {encoding: 'utf8', timeout: 5000});
		try {
			assert.ifError(child.error);
			assert.equal(child.status, 2, 'invalid settings must be an environment error');
			assert.match(child.stderr, /Invalid repetitions or timeout/);
			assert.equal(fs.existsSync(output), false, 'invalid settings must fail before browser setup');
			console.log('PASS', name);
		} catch (error) {
			failed++;
			console.error('FAIL', name, error.message);
		}
	}
} finally { fs.rmSync(root, {recursive: true, force: true}); }

console.log(`${cases.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
