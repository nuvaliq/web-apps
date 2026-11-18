const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, i, all) => {
	if (value.startsWith('--')) out.push([value.slice(2), all[i + 1]]);
	return out;
}, []));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class EnvironmentError extends Error {}
let config, manifest, artifact, browser;
const results = [], loaded = new Set();

function geometryMatches(initial, frames, outerInitial, outerFrames, searchVisible) {
	const positions = ['headerTop', 'menuTop', 'footerBottom'];
	if (!searchVisible || !frames.length || !outerFrames.length ||
		!Number.isFinite(initial.frameHeight) || Math.abs(initial.footerBottom - initial.frameHeight) > 1 ||
		!positions.every(name => Number.isFinite(initial[name]))) return false;
	return frames.every(frame => frame.scroll === 0 && frame.transform === 'none' &&
		positions.every(name => Number.isFinite(frame[name]) && Math.abs(frame[name] - initial[name]) <= 1) &&
		frame.documentScrollX === initial.documentScrollX && frame.documentScrollY === initial.documentScrollY) &&
		outerFrames.every(frame => frame.scrollX === outerInitial.scrollX && frame.scrollY === outerInitial.scrollY);
}

async function until(fn, name) {
	const deadline = Date.now() + config.timeoutMs;
	while (Date.now() < deadline) { if (await fn()) return; await delay(50); }
	throw new EnvironmentError('Timed out: ' + name);
}

async function open(reduce = false) {
	const verified = new Set();
	const context = await browser.newContext({viewport: {width: 1280, height: 666},
		deviceScaleFactor: 1, reducedMotion: reduce ? 'reduce' : 'no-preference',
		...(config.storageStatePath ? {storageState: config.storageStatePath} : {})});
	await context.route('**/*', async route => {
		const url = new URL(route.request().url());
		const index = url.pathname.indexOf('/web-apps/');
		if (index < 0) return route.continue();
		const relative = decodeURIComponent(url.pathname.slice(index + '/web-apps/'.length));
		const file = path.resolve(artifact, relative);
		if (!file.startsWith(artifact + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			return route.continue();
		}
		const body = fs.readFileSync(file), expected = manifest.assets.find(a =>
			a.path.replace(/^deploy\/web-apps\//, '') === relative);
		if (/\.(js|css)$/.test(file)) {
			if (!expected || digest(body) !== expected.sha256) throw new EnvironmentError('Build asset mismatch');
			loaded.add(relative);
			verified.add(relative);
		}
		const ext = path.extname(file);
		return route.fulfill({body, contentType: ({'.js': 'application/javascript', '.css': 'text/css',
			'.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml'})[ext] || 'application/octet-stream'});
	});
	const page = await context.newPage();
	await page.goto(config.editorUrl);
	let frame;
	await until(async () => {
		const frames = [];
		for (const f of page.frames()) {
			if (await f.evaluate(() => !!window.SSE?.getController?.('Main')?._isDocReady &&
				!!window.SSE?.getController?.('Main')?.api?.wb &&
				!!document.getElementById('area_id') && document.body.classList.contains('vo-compact')).catch(() => false)) frames.push(f);
		}
		if (frames.length > 1) throw new EnvironmentError('More than one editor frame');
		frame = frames[0]; return !!frame;
	}, 'editable spreadsheet');
	if (![...verified].some(a => /apps\/spreadsheeteditor\/main\/.*\.js$/.test(a)) ||
		![...verified].some(a => /apps\/spreadsheeteditor\/main\/.*\.css$/.test(a))) {
		throw new EnvironmentError('The spreadsheet JS and CSS were not verified');
	}
	await frame.evaluate(({sheet, cell}) => {
		const api = SSE.getController('Main').api;
		let selected = false;
		for (let i = 0; i < api.asc_getWorksheetsCount(); i++) {
			if (api.asc_getWorksheetName(i) === sheet) { api.asc_showWorksheet(i); selected = true; break; }
		}
		if (!selected) throw new Error('Worksheet not found');
		api.asc_findCell(cell);
		api.asc_enableKeyEvents(true);
		document.getElementById('area_id').focus();
	}, {sheet: config.sheetName, cell: config.cellAddress});
	return {context, page, frame};
}

async function readText(frame) {
	return frame.evaluate(cell => {
		const api = SSE.getController('Main').api;
		api.asc_findCell(cell);
		return String(api.asc_getCellInfo().asc_getText());
	}, config.cellAddress);
}

async function record(frame, page) {
	await page.evaluate(() => {
		const initial = {scrollX, scrollY};
		window.outerMotionProbe = {initial, frames: [initial], running: true};
		const tick = () => {
			outerMotionProbe.frames.push({scrollX, scrollY});
			if (outerMotionProbe.running) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await frame.evaluate(() => {
		const viewport = document.getElementById('viewport');
		window.motionProbe = {frames: [], scrolls: [], running: true};
		const probe = motionProbe;
		probe.listener = () => probe.scrolls.push(viewport.scrollTop);
		viewport.addEventListener('scroll', probe.listener);
		function read(time) {
			const shell = SSE.Views.CompactShell, mid = shell.middle(shell.layout());
			return {time, scroll: viewport.scrollTop,
				inputTop: document.getElementById('area_id_parent').getBoundingClientRect().top,
				headerTop: shell.rows?.header?.getBoundingClientRect().top,
				menuTop: shell.rows?.menu?.getBoundingClientRect().top,
				footerBottom: document.getElementById('statusbar').getBoundingClientRect().bottom,
				frameHeight: innerHeight, documentScrollX: scrollX, documentScrollY: scrollY,
				transform: getComputedStyle(mid).transform, moving: !!shell.motion,
				toolbarHeight: document.getElementById('toolbar').getBoundingClientRect().height};
		}
		probe.initial = read(performance.now());
		probe.frames.push(probe.initial);
		function tick(time) {
			probe.frames.push(read(time));
			if (probe.running) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	});
}

async function finishRecord(frame, page) {
	const outer = await page.evaluate(() => {
		outerMotionProbe.running = false;
		return {outerInitial: outerMotionProbe.initial, outerFrames: outerMotionProbe.frames};
	});
	return {...outer, ...await frame.evaluate(() => {
		const p = motionProbe; p.running = false;
		document.getElementById('viewport').removeEventListener('scroll', p.listener);
		return {initial: p.initial, frames: p.frames,
			maxScroll: Math.max(0, ...p.scrolls, ...p.frames.map(f => f.scroll))};
	})};
}

async function waitMotion(frame) {
	await frame.waitForFunction(() => {
		const bar = window.requirejs?.s.contexts._.defined['spreadsheeteditor/main/app/view/FormulaBar'];
		return !SSE.Views.CompactShell.motion && !bar?.anim;
	}, null, {timeout: config.timeoutMs});
	await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function reset() {
	if (!config.resetUrl) throw new EnvironmentError('A test-copy reset endpoint is required');
	const response = await fetch(config.resetUrl, {method: 'POST'});
	if (!response.ok) throw new EnvironmentError('Could not reset the test copy');
}

async function scenario(reduce, key, phase, index) {
	await reset();
	let {context, page, frame} = await open(reduce);
	const result = {reduce, key, phase, index};
	try {
		const original = await readText(frame);
		if (digest(original) !== config.originalValueSha256) throw new EnvironmentError('Initial value differs');
		if (await frame.evaluate(() => document.getElementById('viewport').scrollTop) !== 0) {
			throw new EnvironmentError('Initial viewport has already scrolled');
		}
		await record(frame, page);
		await page.keyboard.press('F2');
		if (phase === 'during' && !reduce) {
			await frame.waitForFunction(() => !!SSE.Views.CompactShell.motion, null, {timeout: config.timeoutMs});
			await page.waitForTimeout(90);
			if (!await frame.evaluate(() => !!SSE.Views.CompactShell.motion)) throw new EnvironmentError('The transition ended before input');
		} else if (phase === 'after') await waitMotion(frame);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Alt+Enter');
		const marker = 'Keyboard verification ' + index;
		await page.keyboard.insertText(marker);
		await page.keyboard.press(key);
		await waitMotion(frame);
		const expected = key === 'Escape' ? original : original + '\n' + marker;
		const actual = await readText(frame);
		result.valueMatches = actual === expected;
		result.valueSha256 = digest(actual);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
		const search = frame.locator('#search-bar-text:visible, #sd-text-search:visible').first();
		await search.waitFor({state: 'visible', timeout: config.timeoutMs});
		result.searchVisible = await search.isVisible();
		await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		Object.assign(result, await finishRecord(frame, page));
		result.scrollAfterSearch = await frame.evaluate(() => document.getElementById('viewport').scrollTop);
		result.geometryMatches = geometryMatches(result.initial, result.frames,
			result.outerInitial, result.outerFrames, result.searchVisible);
		if (key !== 'Escape') {
			await frame.evaluate(() => SSE.getController('Main').api.asc_Save());
			await frame.waitForFunction(() => !SSE.getController('Main').api.asc_isDocumentModified(), null,
				{timeout: config.timeoutMs});
			if (config.saveUrl) {
				const response = await fetch(config.saveUrl, {method: 'POST'});
				if (!response.ok) throw new EnvironmentError('Save request failed');
			}
			if (config.saveStatusUrl) await until(async () => {
				const response = await fetch(config.saveStatusUrl); return (await response.json()).saveCount > 0;
			}, 'saved test copy');
		}
		await context.close();
		if (config.reopenUrl) await fetch(config.reopenUrl, {method: 'POST'});
		({context, page, frame} = await open(reduce));
		result.reopenedMatches = (await readText(frame)) === expected;
		result.passed = result.geometryMatches && result.maxScroll === 0 && result.scrollAfterSearch === 0 &&
			result.valueMatches && result.reopenedMatches;
		if (!result.passed) await page.screenshot({path: path.join(args.output, 'failure-' + index + '.png')});
		results.push(result);
		console.log(result.passed ? 'PASS' : 'FAIL', key, phase, reduce ? 'reduced' : 'normal', result.maxScroll);
	} finally { await context.close(); }
}

async function profile() {
	await reset();
	const {context, page, frame} = await open();
	try {
		const idle = await frame.evaluate(async () => {
			const times = [], end = performance.now() + 2000;
			while (performance.now() < end) times.push(await new Promise(requestAnimationFrame));
			return times.slice(1).map((t, i) => t - times[i]);
		});
		const intervals = [];
		for (let i = 0; i < 13; i++) {
			if (digest(await readText(frame)) !== config.originalValueSha256) throw new EnvironmentError('Profile cell differs');
			await frame.evaluate(() => {
				// Reset only between recorded cycles; the regression mode never resets scrolling.
				document.getElementById('viewport').scrollTop = 0;
				document.getElementById('area_id').focus();
			});
			await record(frame, page);
			await page.keyboard.press('F2');
			await frame.waitForFunction(() => !!SSE.Views.CompactShell.motion, null, {timeout: config.timeoutMs});
			await waitMotion(frame);
			await page.keyboard.press('Enter');
			await frame.waitForFunction(() => !!SSE.Views.CompactShell.motion, null, {timeout: config.timeoutMs});
			await waitMotion(frame);
			const samples = (await finishRecord(frame, page)).frames;
			if (i >= 3) {
				for (let j = 1; j < samples.length; j++) if (samples[j].moving && samples[j - 1].moving) {
					intervals.push(samples[j].time - samples[j - 1].time);
				}
			}
		}
		if (!intervals.length) throw new EnvironmentError('No active transition frames');
		const percentile = (values, fraction) => values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
		return {p95: percentile(intervals, .95), T: percentile(idle, .5), intervals};
	} finally { await context.close(); }
}

async function main() {
	if (!args.config || !args.output || !['regression', 'control', 'profile', 'all'].includes(args.mode)) {
		throw new EnvironmentError('Required: --config <json> --output <new directory> --mode regression|control|profile|all');
	}
	config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
	if (!config || !Number.isSafeInteger(config.repetitions) || config.repetitions < 10 ||
		!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1500) {
		throw new EnvironmentError('Invalid repetitions or timeout');
	}
	manifest = JSON.parse(fs.readFileSync(config.manifestPath, 'utf8'));
	artifact = path.resolve(path.dirname(config.manifestPath), 'deploy/web-apps');
	fs.mkdirSync(args.output);
	browser = await chromium.launch({headless: true, channel: config.browserChannel || 'chrome'});
	try {
		let timing;
		if (args.mode === 'profile') timing = await profile();
		else {
			for (let i = 0; i < config.repetitions; i++) await scenario(args.mode === 'control', 'Enter', 'during', i);
			if (args.mode === 'all') {
				for (const [key, phase] of [['Enter', 'fast'], ['Enter', 'after'], ['Escape', 'during'], ['Tab', 'during']]) {
					await scenario(false, key, phase, results.length);
				}
				await scenario(true, 'Enter', 'fast', results.length);
			}
		}
		fs.writeFileSync(path.join(args.output, 'result.json'), JSON.stringify({revision: manifest.revision,
			browser: browser.version(), platform: process.platform, results, timing, assetsVerified: [...loaded]}, null, 2));
		process.exitCode = results.some(r => !r.passed) ? 1 : 0;
	} finally { await browser.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = e instanceof EnvironmentError ? 2 : 1; });
module.exports = {geometryMatches};
