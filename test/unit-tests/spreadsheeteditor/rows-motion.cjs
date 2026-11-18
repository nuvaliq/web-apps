const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '../../..');
const SHELL = process.argv[2] || path.join(ROOT, 'apps/spreadsheeteditor/main/app/view/CompactShell.js');
const LESS = process.argv[3] || path.join(ROOT, 'apps/spreadsheeteditor/main/resources/less/compact-shell.less');
const layer = require('./lib/compact-less.cjs');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
let page, css;

async function setup(options = {}) {
	await page.emulateMedia({reducedMotion: options.reduce ? 'reduce' : 'no-preference'});
	await page.setContent(`<style>${css}
		body { margin:0; } #root,#viewport { position:absolute;width:100%;height:666px;overflow:hidden; }
		.layout-item { position:absolute;left:0;width:100%; } #middle { margin-top:${options.margin || 0}px; }
		#field { position:fixed;top:450px;left:20px;width:20px;height:20px; }
		</style><body class="vo-compact"><div id="root"><div id="viewport">
		<div id="app-title" class="layout-item"></div><div id="toolbar" class="layout-item">
		<div id="vo-shell"></div></div><div id="middle" class="layout-item"><textarea id="field"></textarea></div>
		<div id="statusbar" class="layout-item"></div></div></div></body>`);
	for (const file of ['vendor/jquery/jquery.min.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js']) {
		await page.addScriptTag({path: path.join(ROOT, file)});
	}
	await page.evaluate(() => {
		window.Common = {UI: {}, NotificationCenter: _.extend({}, Backbone.Events)};
		window.SSE = {Views: {}};
		window.define = (deps, factory) => factory();
	});
	await page.addScriptTag({path: path.join(ROOT, 'apps/common/main/lib/component/Layout.js')});
	await page.addScriptTag({path: path.resolve(SHELL)});
	await page.evaluate(options => {
		const v = new Common.UI.VBoxLayout({box: $('#toolbar'), items: [
			{el: $('#app-title'), alias: 'title', height: 0},
			{el: $('#toolbar'), alias: 'toolbar', height: 168},
			{el: $('#middle'), alias: 'middle', stretch: true},
			{el: $('#statusbar'), alias: 'statusbar', height: 36}
		]});
		const mid = document.getElementById('middle');
		if (options.inline) mid.style.setProperty('margin-top', options.inline, options.priority || '');
		window.target = 168;
		window.resizeCalls = 0;
		window.shell = SSE.Views.CompactShell;
		SSE.getController = name => name === 'Viewport' ? {viewport: {vlayout: v}} : null;
		shell.api = {asc_Resize() { resizeCalls++; }};
		shell.ours = true;
		shell.applied = {title: 0, toolbar: 168};
		shell.subs = [];
		shell.shellHeight = () => target;
		shell.syncPlate = () => {};
		Common.NotificationCenter.on('layout:changed', () => shell.api.asc_Resize());
		shell.bindMotion();
		window.start = height => { target = height; shell.applyLayout(true, true); };
		window.snapshot = () => ({
			top: mid.getBoundingClientRect().top, toolbarBottom: document.getElementById('toolbar').getBoundingClientRect().bottom,
			fieldTop: document.getElementById('field').getBoundingClientRect().top,
			transform: getComputedStyle(mid).transform, margin: mid.style.getPropertyValue('margin-top'),
			priority: mid.style.getPropertyPriority('margin-top'), scroll: document.getElementById('viewport').scrollTop,
			moving: !!shell.motion, holding: !!shell.resizeHold, calls: resizeCalls,
			following: mid.classList.contains('vo-rows-follow')
		});
	}, options);
}

async function settled() {
	await page.waitForFunction(() => !shell.motion && !shell.resizeHold, {timeout: 3000});
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	return page.evaluate(() => snapshot());
}

async function sampleTransition(height) {
	return page.evaluate(async height => {
		start(height);
		document.getElementById('field').focus();
		const frames = [];
		for (let i = 0; i < 90; i++) {
			await new Promise(requestAnimationFrame);
			frames.push(snapshot());
			if (!shell.motion) break;
		}
		return frames;
	}, height);
}

test('focused_fixed_input_stays_in_view_during_growth_and_collapse', async () => {
	await setup();
	for (const height of [300, 168]) {
		const frames = await sampleTransition(height);
		assert.ok(frames.length > 2, 'the transition must have intermediate frames');
		for (const frame of frames) {
			assert.equal(frame.transform, 'none', 'a transformed ancestor changes the fixed input coordinates');
			assert.equal(frame.fieldTop, 450, 'the input moved with the middle area');
			assert.equal(frame.scroll, 0, 'the outer viewport scrolled');
			assert.ok(Math.abs(frame.top - frame.toolbarBottom) <= 1, 'the grid left the toolbar edge');
		}
		const end = await settled();
		assert.equal(end.top, height);
		assert.equal(end.margin, '');
		assert.equal(end.following, false);
	}
	assert.equal((await page.evaluate(() => snapshot())).calls, 2);
});

for (const [name, options, expected] of [
	['stylesheet_margin', {margin: 9}, ''],
	['inline_margin', {inline: '11px'}, '11px'],
	['important_inline_margin', {inline: '13px', priority: 'important'}, '13px']
]) {
	test(name + '_survives_normal_and_interrupted_transitions', async () => {
		await setup(options);
		const original = await page.evaluate(() => snapshot());
		await page.evaluate(() => start(300));
		await settled();
		let end = await page.evaluate(() => snapshot());
		assert.equal(end.margin, expected);
		assert.equal(end.priority, options.priority || '');
		assert.ok(Math.abs(end.top - end.toolbarBottom - (original.top - original.toolbarBottom)) <= 1);
		await page.evaluate(() => start(168));
		await page.evaluate(() => shell.finishMotion());
		end = await settled();
		assert.equal(end.margin, expected);
		assert.equal(end.priority, options.priority || '');
		assert.ok(Math.abs(end.top - original.top) <= 1);
	});
}

test('reverse_transition_starts_at_the_visible_grid_position', async () => {
	await setup({margin: 9});
	await page.evaluate(() => start(300));
	await page.waitForFunction(() => {
		const h = document.getElementById('toolbar').getBoundingClientRect().height;
		return h > 180 && h < 290;
	});
	const delta = await page.evaluate(() => {
		const before = snapshot().top;
		start(168);
		return Math.abs(snapshot().top - before);
	});
	assert.ok(delta <= 1, 'reversing the transition jumped by ' + delta);
	const end = await settled();
	assert.equal(end.top, 177);
});

test('late_cancel_does_not_finish_a_new_transition', async () => {
	await setup();
	await page.evaluate(() => start(300));
	await page.waitForFunction(() => document.getElementById('toolbar').getBoundingClientRect().height > 180);
	const moving = await page.evaluate(() => {
		start(168);
		document.getElementById('toolbar').dispatchEvent(new TransitionEvent('transitioncancel', {propertyName: 'height'}));
		return !!shell.motion;
	});
	assert.equal(moving, true);
	await settled();
});

test('fallback_finishes_without_transition_events', async () => {
	await setup();
	await page.evaluate(() => {
		const toolbar = document.getElementById('toolbar');
		for (const type of ['transitionend', 'transitioncancel']) toolbar.addEventListener(type, e => e.stopImmediatePropagation(), true);
		start(300);
	});
	const end = await settled();
	assert.equal(end.top, 300);
	assert.equal(end.following, false);
	assert.equal(end.calls, 1);
});

test('nested_resize_hold_survives_motion_cleanup', async () => {
	await setup();
	const result = await page.evaluate(() => {
		shell.holdResize();
		const outer = shell.resizeHold, held = shell.api.asc_Resize;
		start(300);
		shell.finishMotion();
		const result = {same: outer === shell.resizeHold, depth: outer.depth, sameFunction: held === shell.api.asc_Resize};
		shell.releaseResize();
		return result;
	});
	assert.deepEqual(result, {same: true, depth: 1, sameFunction: true});
});

test('collapse_merges_layout_and_window_resize_requests', async () => {
	await setup();
	await page.evaluate(() => start(300));
	await settled();
	await page.evaluate(() => {
		window.addEventListener('resize', () => shell.api.asc_Resize());
		resizeCalls = 0;
		start(168);
	});
	assert.equal((await settled()).calls, 1);
});

test('resize_error_still_restores_styles_and_the_engine_function', async () => {
	await setup({inline: '13px', priority: 'important'});
	const result = await page.evaluate(() => {
		const failing = () => { throw new Error('resize rejected'); };
		shell.api.asc_Resize = failing;
		start(300);
		let rejected = false;
		try { shell.finishMotion(); } catch (e) { rejected = true; }
		shell.finishMotion();
		return {...snapshot(), rejected, restored: shell.api.asc_Resize === failing};
	});
	assert.equal(result.rejected, true);
	assert.equal(result.restored, true);
	assert.equal(result.holding, false);
	assert.equal(result.margin, '13px');
	assert.equal(result.priority, 'important');
});

test('transition_longhands_and_their_priorities_are_restored', async () => {
	await setup();
	const state = await page.evaluate(() => {
		const middle = document.getElementById('middle'), toolbar = document.getElementById('toolbar');
		middle.style.setProperty('transition-duration', '0.5s', 'important');
		middle.style.setProperty('transition-property', 'margin-top');
		toolbar.style.setProperty('transition-duration', '0.5s', 'important');
		toolbar.style.setProperty('transition-property', 'height');
		window.transitions = () => [middle, toolbar].map(el => Array.from(el.style)
			.filter(name => name.startsWith('transition')).sort()
			.map(name => [name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]));
		return transitions();
	});
	await page.evaluate(() => start(300));
	await settled();
	assert.deepEqual(await page.evaluate(() => transitions()), state);
});

test('a_resize_error_at_collapse_start_restores_temporary_styles', async () => {
	await setup();
	await page.evaluate(() => start(300));
	await settled();
	const result = await page.evaluate(() => {
		const toolbar = document.getElementById('toolbar'), middle = document.getElementById('middle');
		shell.api.asc_Resize = () => { throw new Error('collapse resize rejected'); };
		let rejected = false;
		try { start(168); } catch (e) { rejected = true; }
		shell.finishMotion();
		return {rejected, moving: !!shell.motion, holding: !!shell.resizeHold,
			toolbarTransition: toolbar.style.transition, middleTransition: middle.style.transition};
	});
	assert.deepEqual(result, {rejected: true, moving: false, holding: false, toolbarTransition: '', middleTransition: ''});
});

test('acceptance_metrics_reject_displaced_chrome_and_unopened_search', async () => {
	const {geometryMatches} = require('../../e2e/spreadsheeteditor/viewport-scroll.cjs');
	const initial = {headerTop: 0, menuTop: 46, footerBottom: 666, frameHeight: 666,
		documentScrollX: 0, documentScrollY: 0};
	const frame = {...initial, scroll: 0, transform: 'none'};
	const outer = {scrollX: 0, scrollY: 0};
	assert.equal(geometryMatches(initial, [frame], outer, [outer], true), true);
	for (const wrong of [{headerTop: -7}, {menuTop: 39}, {footerBottom: 650},
		{transform: 'matrix(1, 0, 0, 1, 0, 0)'}, {documentScrollY: 5}]) {
		assert.equal(geometryMatches(initial, [{...frame, ...wrong}], outer, [outer], true), false);
	}
	assert.equal(geometryMatches(initial, [frame], outer, [{scrollX: 0, scrollY: 5}], true), false);
	assert.equal(geometryMatches(initial, [frame], outer, [outer], false), false);
});

test('window_resize_cleans_up_the_transition', async () => {
	await setup();
	await page.evaluate(() => { start(300); window.dispatchEvent(new Event('resize')); });
	const end = await settled();
	assert.equal(end.top, 300);
	assert.equal(end.margin, '');
	assert.equal(end.calls, 1);
});

test('removed_middle_is_cleaned_up_without_waiting_for_its_events', async () => {
	await setup({inline: '7px'});
	const result = await page.evaluate(() => {
		start(300);
		const mid = document.getElementById('middle');
		mid.remove();
		shell.finishMotion();
		shell.finishMotion();
		return {moving: !!shell.motion, holding: !!shell.resizeHold,
			margin: mid.style.marginTop, following: mid.classList.contains('vo-rows-follow')};
	});
	assert.deepEqual(result, {moving: false, holding: false, margin: '7px', following: false});
});

test('focusing_offscreen_editor_content_does_not_scroll_the_outer_shell', async () => {
	await setup();
	const positions = await page.evaluate(() => {
		const input = document.createElement('input');
		input.style.cssText = 'position:absolute;top:900px;left:0;width:20px;height:20px';
		document.getElementById('middle').appendChild(input);
		input.focus();
		return {viewport: document.getElementById('viewport').scrollTop,
			root: document.getElementById('root').scrollTop, page: document.scrollingElement.scrollTop};
	});
	assert.deepEqual(positions, {viewport: 0, root: 0, page: 0});
});

test('reduced_motion_and_unchanged_heights_do_not_leave_motion_state', async () => {
	await setup({reduce: true});
	await page.evaluate(() => start(300));
	let end = await settled();
	assert.equal(end.top, 300);
	assert.equal(end.calls, 1);
	await setup();
	await page.evaluate(() => start(168));
	end = await settled();
	assert.equal(end.margin, '');
	assert.equal(end.following, false);
});

(async () => {
	const less = require(path.join(ROOT, 'build/node_modules/less'));
	css = (await less.render(layer.source(LESS), {filename: layer.APP_LESS})).css;
	const engine = engines[process.env.BROWSER_ENGINE || 'chromium'];
	const browser = await engine.launch({headless: true,
		executablePath: (process.env.BROWSER_ENGINE || 'chromium') === 'chromium' ? process.env.CHROMIUM_PATH : undefined});
	let failed = 0;
	try {
		page = await browser.newPage({viewport: {width: 1280, height: 666}});
		for (const [name, fn] of tests) {
			try { await fn(); console.log('PASS', name); }
			catch (e) { failed++; console.error('FAIL', name, e.message); }
		}
	} finally { await browser.close(); }
	console.log(`${tests.length - failed} passed, ${failed} failed`);
	process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
