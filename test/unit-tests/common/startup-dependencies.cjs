'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {once} = require('node:events');
const {test} = require('node:test');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../../..');
const utils = 'common/main/lib/util/utils';
const scenarios = [
	{
		name: 'ExtendedColorDialog',
		module: 'common/main/lib/view/ExtendedColorDialog',
		dependency: 'common/main/lib/component/Window',
		preload: ['common/main/lib/component/BaseView', utils]
	},
	{
		name: 'DimensionPicker',
		module: 'common/main/lib/component/DimensionPicker',
		dependency: utils,
		preload: []
	},
	...['ColorPaletteExt', 'HSBColorPicker', 'MaskedField', 'TextareaField'].map((name) => ({
		name,
		module: 'common/main/lib/component/' + name,
		dependency: 'common/main/lib/component/BaseView',
		preload: []
	}))
];

test('AMD startup dependencies', async (t) => {
	const server = http.createServer((request, response) => {
		const pathname = new URL(request.url, 'http://localhost').pathname;
		if (pathname === '/') {
			response.writeHead(200, {'Content-Type': 'text/html'});
			response.end('<!doctype html><title>AMD startup test</title>');
			return;
		}

		const file = path.resolve(root, '.' + pathname);
		const isAsset = ['apps', 'vendor'].some((dir) => file.startsWith(path.join(root, dir) + path.sep));
		if (!isAsset || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			response.writeHead(404);
			response.end();
			return;
		}

		response.writeHead(200, {'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/plain'});
		fs.createReadStream(file).pipe(response);
	});
	t.after(() => new Promise((resolve) => {
		server.close(resolve);
		server.closeIdleConnections();
	}));
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');

	const origin = 'http://127.0.0.1:' + server.address().port;
	const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH});
	t.after(() => browser.close());

	for (const scenario of scenarios) {
		await t.test(scenario.name + ' waits for ' + path.basename(scenario.dependency), async () => {
			const context = await browser.newContext();
			let release;
			const hold = new Promise((resolve) => { release = resolve; });
			try {
				const page = await context.newPage();
				const errors = [];
				page.on('pageerror', (error) => errors.push(error.message));
				await page.goto(origin);
				for (const library of ['jquery', 'underscore', 'backbone']) {
					await page.addScriptTag({url: origin + '/vendor/' + library + '/' + library + '.js'});
				}
				await page.addScriptTag({url: origin + '/vendor/requirejs/require.js'});

				const dependency = origin + '/apps/' + scenario.dependency + '.js';
				let markRequested;
				const requested = new Promise((resolve) => { markRequested = resolve; });
				await page.route(dependency, async (route) => {
					markRequested();
					await hold;
					await route.continue();
				});
				const consumer = origin + '/apps/' + scenario.module + '.js';
				const delivered = page.waitForResponse(consumer, {timeout: 5000}).then((response) => response.finished());
				const loaded = page.evaluate(async ({origin, scenario}) => {
					window.Common = {UI: {Window: {}}, Utils: {}};
					require.config({
						baseUrl: origin + '/apps',
						paths: {text: '../vendor/requirejs-text/text'},
						waitSeconds: 5
					});
					define('backbone', [], () => Backbone);
					define('underscore', [], () => _);
					define('jquery', [], () => jQuery);

					const load = (ids) => new Promise((resolve, reject) => {
						require.onError = reject;
						require(ids, resolve, reject);
					});
					try {
						if (scenario.preload.length) {
							await load(scenario.preload);
						}
						await load([scenario.module]);
						const Component = Common.UI[scenario.name];
						return {
							constructor: typeof Component,
							template: scenario.name === 'ExtendedColorDialog'
								? Component.prototype.tpl({txtNew: 'New', txtCurrent: 'Current'})
								: null
						};
					} catch (error) {
						return {error: error.stack || error.message};
					}
				}, {origin, scenario});

				const earlyResult = await Promise.race([
					Promise.all([requested, delivered]).then(() => null),
					loaded
				]);
				assert.equal(earlyResult, null, earlyResult?.error || 'Component loaded before its dependency');
				assert.equal(await page.evaluate((name) => typeof Common.UI[name], scenario.name), 'undefined');
				assert.deepEqual(errors, []);

				release();
				const result = await loaded;
				assert.equal(result.error, undefined, result.error);
				assert.equal(result.constructor, 'function');
				if (scenario.name === 'ExtendedColorDialog') {
					assert.match(result.template, /id="id-hsb-colorpicker"/);
				}
				assert.deepEqual(errors, []);
			} finally {
				release();
				await context.close();
			}
		});
	}
});
