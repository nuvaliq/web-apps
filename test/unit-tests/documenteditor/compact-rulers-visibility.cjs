/* Run: node test/unit-tests/documenteditor/compact-rulers-visibility.cjs
 * Release-minified compact styles and real actions with SDK ruler geometry reproduced in DOM.
 * This checks the shell layout, not document rendering or ruler drag in the SDK.
 * COMPACT_SOURCE_ROOT selects production JS/LESS for the unchanged-source run.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const source = process.env.COMPACT_SOURCE_ROOT || root;
const lessModule = process.env.LESS_MODULE || path.join(root, 'build/node_modules/less');
const less = require(lessModule);
const CleanCSSPlugin = require(require.resolve('less-plugin-clean-css', {
	paths: [path.dirname(require.resolve(lessModule))]
}));
const view = 'apps/documenteditor/main/app/view';

(async () => {
	const lessFile = path.join(source, 'apps/documenteditor/main/resources/less/app.less');
	const css = await less.render(fs.readFileSync(lessFile, 'utf8'), {
		filename: lessFile,
		compress: true,
		ieCompat: false,
		plugins: [new CleanCSSPlugin()],
		modifyVars: JSON.parse(fs.readFileSync(path.join(source, 'build/documenteditor.json'))).main.less.vars
	});
	const browser = await chromium.launch({headless: true,
		executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
	let passed = 0, failed = 0;
	try {
		const page = await browser.newPage({viewport: {width: 1440, height: 900}});
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.setContent(`<style>${css.css}</style><style>body { margin: 0; }</style>
			<div id="viewport" style="position:relative;width:100%;height:100vh">
			<div id="toolbar"><div id="vo-shell">
				<div class="vo-hd" style="height:46px">Document</div>
				<div class="vo-mn" style="height:30px"><button id="toggle-rulers">Rulers</button></div>
				<div id="vo-tb"><button>Format</button></div>
			</div></div>
			<div id="content-row" class="layout-item middle" style="position:absolute;left:0;right:0;bottom:0">
			<div id="viewport-hbox-layout" style="position:relative;width:100%;height:100%">
			<div id="editor_sdk" style="position:absolute;left:0;top:0;width:100%;bottom:0">
				<div id="id_panel_top" style="position:absolute;top:0;left:19px;right:14px;height:26px">
					<canvas id="id_hor_ruler" style="width:100%;height:26px"></canvas>
				</div>
				<div id="id_main_view" style="position:absolute;left:0;right:14px;bottom:0">
					<div id="page" style="position:absolute;left:200px;width:600px;height:1000px"></div>
				</div>
			</div>
			<div id="vo-outline" class="has-items"><div class="vo-outline-panel">
				<button class="vo-ib vo-outline-toggle">Outline</button><div class="vo-outline-list">Heading</div>
			</div></div>
			<div id="left-menu" style="position:absolute;top:0;left:0">Comments</div>
			</div></div></div>
			<div class="asc-window search-bar" style="display:none;position:absolute;width:400px;z-index:100">Search</div>`);
		await page.addScriptTag({content: fs.readFileSync(path.join(source, 'vendor/jquery/jquery.js'), 'utf8')});
		await page.evaluate(() => {
			window._ = {extend: Object.assign};
			window.define = (dependencies, factory) => factory({});
			window.settings = {};
			window.saved = {};
			window.checkbox = null;
			window.state = {rulers: false, offset: 0, layouts: 0, setterCalls: 0};
			window.options = {isEdit: true, customization: {}};
			window.callbacks = {};
			window.notifications = {};
			window.DE = {Views: {}, getController(name) {
				if (name === 'Main') return {appOptions: options};
				if (name === 'Viewport') return {viewport: window.viewport};
				if (name === 'ViewTab') return {view: {chRulers: {setValue(show) { checkbox = show; }}}};
				return null;
			}};
			window.Common = {
				NotificationCenter: {
					on(name, callback) { (notifications[name] ||= []).push(callback); },
					trigger(name, ...args) { (notifications[name] || []).forEach(callback => callback(...args)); }
				},
				Utils: {InternalSettings: {set(k, v) { settings[k] = v; }}},
				localStorage: {
					itemExists(k) { return k in saved; }, getBool(k) { return saved[k]; },
					setBool(k, v) { saved[k] = v; }
				}
			};
			window.sdkLayout = () => {
				document.getElementById('id_panel_top').style.display = state.rulers ? 'block' : 'none';
				document.getElementById('id_main_view').style.top = (state.rulers ? 26 : 0) + 'px';
				document.getElementById('page').style.top = (20 + state.offset) + 'px';
			};
			window.api = {
				asc_GetViewRulers() { return state.rulers; },
				asc_SetViewRulers(show) { state.setterCalls++; state.rulers = show; sdkLayout(); },
				asc_registerCallback(name, callback) { (callbacks[name] ||= []).push(callback); },
				Resize: sdkLayout,
				WordControl: {
					setOffsetTop(offset) { this.offsetTop = state.offset = offset; },
					CalculateDocumentSize() { this.m_dDocumentHeight = 1000; sdkLayout(); },
					UpdateScrolls() {}, OnScroll() {}
				}
			};
			const toolbar = {height: 112, el: $('#toolbar')};
			window.viewport = {
				vlayout: {
					getItem(id) { return id === 'toolbar' ? toolbar : null; },
					doLayout() {
						state.layouts++;
						document.getElementById('content-row').style.top = toolbar.height + 'px';
					}
				},
				hlayout: {doLayout() {}}
			};
		});
		for (const name of ['DocumentActions', 'CompactShell', 'OutlineRail']) {
			await page.addScriptTag({content: fs.readFileSync(path.join(source, view, name + '.js'), 'utf8')});
		}
		await page.evaluate(() => {
			window.shell = DE.Views.CompactShell;
			window.actions = DE.Views.DocumentActions;
			shell.api = api;
			shell.docMode = 'edit';
			actions.init(api, shell);
			document.body.classList.add('vo-compact', 'vo-left-open');
			document.getElementById('toggle-rulers').onclick = () => actions.toggleRulers();
			shell.applyLayout(true);
			actions.setRulers(false, false);
			shell.bindEditingLock();
		});

		const probe = () => page.evaluate(() => {
			const box = id => {
				const r = document.getElementById(id).getBoundingClientRect();
				return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height};
			};
			const ruler = box('id_hor_ruler');
			const hit = document.elementFromPoint((ruler.left + ruler.right) / 2, ruler.top + 10);
			return {ruler, toolbar: box('vo-tb'), editor: box('editor_sdk'), page: box('page'),
				outline: box('vo-outline'), comments: box('left-menu'), state: {...state},
				hit: hit && hit.id, checkbox, hidden: settings['de-hidden-rulers'], saved: {...saved}};
		});
		async function check(name, run) {
			try { await run(); console.log('PASS', name); passed++; }
			catch (error) { console.error('FAIL', name, error.message); failed++; }
		}
		async function show() {
			await page.evaluate(() => actions.setRulers(true, true));
		}

		await check('first click exposes the ruler below the toolbar and accepts its mouse input', async () => {
			await page.locator('#toggle-rulers').click();
			const p = await probe();
			assert.equal(p.state.rulers, true);
			assert(p.ruler.top >= p.toolbar.bottom, `ruler top ${p.ruler.top} < toolbar bottom ${p.toolbar.bottom}`);
			assert.equal(p.ruler.height, 26);
			assert.equal(p.hit, 'id_hor_ruler');
			assert.equal(p.state.offset, 0, 'the toolbar reserve replaces the overlay offset');
			assert.equal(p.checkbox, true);
			assert.equal(p.hidden, false);
		});
		await check('ten toggle cycles restore the overlay geometry and save the choice', async () => {
			await page.evaluate(() => actions.setRulers(false, true));
			const before = await probe();
			for (let i = 0; i < 10; i++) {
				await page.evaluate(() => { actions.toggleRulers(); actions.toggleRulers(); });
			}
			const after = await probe();
			assert.deepEqual(after.editor, before.editor);
			assert.deepEqual(after.page, before.page);
			assert.equal(after.state.offset, 44);
			assert.equal(after.saved['de-hidden-rulers'], true);
		});
		await check('shown rulers do not leave a second toolbar reserve above side panels', async () => {
			await show();
			const p = await probe();
			assert.equal(p.outline.top, p.ruler.bottom);
			assert.equal(p.comments.top, p.editor.top);
		});
		for (const [width, height] of [[1024, 600], [1440, 900]]) {
			await check(`ruler remains reachable at ${width}x${height}`, async () => {
				await page.setViewportSize({width, height});
				await show();
				const p = await probe();
				assert(p.ruler.top >= p.toolbar.bottom);
				assert.equal(p.hit, 'id_hor_ruler');
			});
		}
		await check('collapsed header and toolbar preserve rulers without an overlay offset', async () => {
			await show();
			for (const mode of ['focus', 'hidden', 'view']) {
				await page.evaluate(mode => {
					shell.top = {hidden: mode === 'focus', cause: mode === 'focus' ? 'manual' : null};
					shell.tbHidden = mode === 'hidden';
					shell.docMode = mode === 'view' ? 'view' : 'edit';
					document.body.classList.toggle('vo-top-hidden', mode === 'focus');
					document.body.classList.toggle('vo-tb-hidden', shell.tbHidden);
					document.body.classList.toggle('vo-view', mode === 'view');
					shell.applyLayout(true);
				}, mode);
				const p = await probe();
				assert.equal(p.state.rulers, true);
				assert.equal(p.state.offset, 0);
				assert.equal(p.hit, 'id_hor_ruler');
			}
		});
		await check('Advanced keeps native heights; returning to compact restores the ruler reserve', async () => {
			await page.evaluate(() => {
				shell.top = {hidden: false, cause: null}; shell.tbHidden = false; shell.docMode = 'edit';
				document.body.classList.remove('vo-top-hidden', 'vo-tb-hidden', 'vo-view', 'vo-compact');
				shell.advanced = true;
				shell.applyLayout(false);
				actions.setRulers(false, true);
				actions.setRulers(true, true);
			});
			assert.equal((await probe()).editor.top, 112);
			await page.evaluate(() => {
				shell.advanced = false; document.body.classList.add('vo-compact');
				shell.applyLayout(true); actions.setRulers(actions.rulersWanted(false), false);
			});
			const p = await probe();
			assert(p.ruler.top >= p.toolbar.bottom);
			assert.equal(p.hidden, false);
		});
		await check('reapplying the same ruler choice causes no layout loop', async () => {
			await show();
			const before = (await probe()).state.layouts;
			await page.evaluate(() => { for (let i = 0; i < 10; i++) actions.setRulers(true, false); });
			assert.equal((await probe()).state.layouts, before);
			assert.deepEqual(errors, []);
		});
		await check('outline navigation follows the SDK offset instead of assuming an overlay', async () => {
			for (const offset of [0, 46, 21, undefined]) {
				const y = await page.evaluate(async offset => {
					const wc = api.WordControl;
					wc.offsetTop = offset;
					wc.m_dScrollY = 300;
					wc.m_oDrawingDocument = {ConvertCoordsToCursor() { return {Y: 200}; }};
					let scrolled;
					wc.m_oScrollVerApi = {getMaxScrolledY() { return 1000; }, scrollToY(y) { scrolled = y; }};
					DE.Views.OutlineRail.api = api;
					DE.Views.OutlineRail.scrollToTop({Elements: [{Paragraph: {
						RecalculateCurPos() { return {Y: 0, PageNum: 0}; }
					}}]}, 0);
					await new Promise(resolve => setTimeout(resolve, 0));
					return scrolled;
				}, offset);
				assert.equal(y, 480 - (offset || 0));
			}
		});
		await check('scrolling preserves the toolbar gap above visible rulers in every theme', async () => {
			for (const theme of ['', 'theme-white', 'theme-night']) {
				await page.evaluate(theme => {
					document.body.classList.remove('theme-white', 'theme-night', 'vo-scrolled');
					if (theme) document.body.classList.add(theme);
					document.getElementById('vo-tb').style.transition = 'none';
					shell.top = {hidden: false, cause: null}; shell.tbHidden = false; shell.docMode = 'edit';
					document.body.classList.remove('vo-top-hidden', 'vo-tb-hidden', 'vo-view');
					actions.setRulers(true, false);
				}, theme);
				const before = await probe();
				await page.evaluate(() => document.body.classList.add('vo-scrolled'));
				const after = await probe();
				assert.equal(after.ruler.top - after.toolbar.bottom, before.ruler.top - before.toolbar.bottom,
					`${theme || 'unthemed'}: scrolling must preserve the reserved ruler gap`);
				await page.evaluate(() => actions.setRulers(false, false));
				assert.equal(await page.locator('#vo-tb').evaluate(el => getComputedStyle(el).transform),
					'matrix(1, 0, 0, 1, 0, -4)', 'without rulers the toolbar must still move on scroll');
			}
			await page.evaluate(() => document.body.classList.remove('theme-white', 'theme-night', 'vo-scrolled'));
		});
		await check('release-minified search follows the ruler strip in every compact chrome mode', async () => {
			// Side-panel geometry was checked separately; use the closed-panel SDK layout here.
			await page.evaluate(() => {
				document.body.classList.remove('vo-left-open');
				actions.setRulers(true, false);
			});
			await page.setViewportSize({width: 640, height: 600});
			for (const theme of ['', 'theme-white', 'theme-night']) {
				await page.evaluate(theme => {
					document.body.classList.remove('theme-white', 'theme-night');
					if (theme) document.body.classList.add(theme);
				}, theme);
				for (const mode of ['edit', 'focus', 'hidden', 'view', 'focus-hidden', 'focus-view']) {
					for (const scrolled of [false, true]) {
						for (const open of [false, true]) {
							const p = await page.evaluate(({mode, scrolled, open}) => {
								const collapsed = mode.startsWith('focus');
								shell.top = {hidden: collapsed, cause: collapsed ? 'manual' : null};
								shell.tbHidden = mode.includes('hidden');
								shell.docMode = mode.includes('view') ? 'view' : 'edit';
								document.body.classList.toggle('vo-top-hidden', collapsed);
								document.body.classList.toggle('vo-tb-hidden', shell.tbHidden);
								document.body.classList.toggle('vo-view', shell.docMode === 'view');
								document.body.classList.toggle('vo-scrolled', scrolled);
								document.getElementById('vo-outline').classList.toggle('open', open);
								document.getElementById('vo-outline').style.transition = 'none';
								const search = document.querySelector('.search-bar');
								search.style.display = 'block';
								shell.applyLayout(true);
								const ruler = document.getElementById('id_hor_ruler').getBoundingClientRect();
								const toggle = document.querySelector('.vo-outline-toggle').getBoundingClientRect();
								const searchBox = search.getBoundingClientRect();
								return {rulerBottom: ruler.bottom, outlineTop: toggle.top, searchTop: searchBox.top,
									leftHit: document.elementFromPoint(40, ruler.top + 10).id,
									rightHit: document.elementFromPoint(ruler.right - 20, ruler.top + 10).id};
							}, {mode, scrolled, open});
							assert(p.outlineTop >= p.rulerBottom, `${mode}/${scrolled}/${open}: outline overlaps ruler`);
							assert.equal(p.searchTop, p.rulerBottom + 8,
								`${mode}/${scrolled}/${open}: minified search must keep an 8px gap below the ruler`);
							assert.equal(p.leftHit, 'id_hor_ruler', `${mode}/${scrolled}/${open}: left ruler edge is covered`);
							assert.equal(p.rightHit, 'id_hor_ruler', `${mode}/${scrolled}/${open}: right ruler edge is covered`);
						}
					}
				}
			}
			await page.evaluate(() => document.body.classList.remove('theme-white', 'theme-night'));
		});
		await check('SDK disconnect synchronizes hidden rulers after callback delivery without restoring them', async () => {
			await page.evaluate(() => {
				shell.top = {hidden: false, cause: null}; shell.tbHidden = false; shell.docMode = 'edit';
				document.body.classList.remove('vo-top-hidden', 'vo-tb-hidden', 'vo-view', 'vo-scrolled');
				actions.setRulers(true, false);
			});
			const before = await probe();
			const p = await page.evaluate(async () => {
				(callbacks.asc_onCoAuthoringDisconnect || []).forEach(callback => callback());
				// setViewModeDisconnect hides rulers after sending the SDK callback.
				state.rulers = false; sdkLayout();
				await new Promise(resolve => setTimeout(resolve, 0));
				return {visible: shell.rulersVisible, classOn: document.body.classList.contains('vo-rulers'),
					height: shell.layoutHeight(), offset: state.offset, setterCalls: state.setterCalls};
			});
			assert.equal(p.visible, false);
			assert.equal(p.classOn, false);
			assert.equal(p.height, 80);
			assert.equal(p.offset, 44);
			assert.equal(p.setterCalls, before.state.setterCalls);
		});
		for (const event of ['api:disconnect', 'asc_onDocumentContentReady']) {
			await check(`${event} clears the ruler reserve after the SDK hides rulers`, async () => {
				await page.evaluate(event => {
					options.isEdit = event !== 'asc_onDocumentContentReady';
					shell.top = {hidden: false, cause: null}; shell.tbHidden = false; shell.docMode = options.isEdit ? 'edit' : 'view';
					document.body.classList.remove('vo-top-hidden', 'vo-tb-hidden', 'vo-view', 'vo-scrolled');
					document.body.classList.toggle('vo-view', !options.isEdit);
					actions.setRulers(true, false);
				}, event);
				const before = await probe();
				const p = await page.evaluate(async event => {
					if (event === 'asc_onDocumentContentReady') {
						// A read-only refresh finishes loading after the editing-lock notification.
						Common.NotificationCenter.trigger('editing:disable', true, {}, 'refresh');
						await new Promise(resolve => setTimeout(resolve, 0));
					}
					state.rulers = false; sdkLayout();
					if (event === 'api:disconnect') Common.NotificationCenter.trigger(event);
					else (callbacks[event] || []).forEach(callback => callback());
					await new Promise(resolve => setTimeout(resolve, 0));
					return {visible: shell.rulersVisible, classOn: document.body.classList.contains('vo-rulers'),
						height: shell.layoutHeight(), offset: state.offset, setterCalls: state.setterCalls};
				}, event);
				assert.equal(p.visible, false);
				assert.equal(p.classOn, false);
				assert.equal(p.height, event === 'asc_onDocumentContentReady' ? 76 : 80);
				assert.equal(p.offset, event === 'asc_onDocumentContentReady' ? 0 : 44);
				assert.equal(p.setterCalls, before.state.setterCalls);
			});
		}
		if (process.env.RULER_EVIDENCE_DIR) {
			fs.mkdirSync(process.env.RULER_EVIDENCE_DIR, {recursive: true});
			await page.screenshot({path: path.join(process.env.RULER_EVIDENCE_DIR, 'ruler-layout.png')});
		}
		console.log(`${passed} passed, ${failed} failed; Chrome ${browser.version()}`);
	} finally { await browser.close(); }
	process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
