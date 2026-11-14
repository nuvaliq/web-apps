/* Run: node test/unit-tests/documenteditor/compact-properties-layout.cjs
 * Browser geometry using production styles and shell actions; SDK construction is a fixture boundary.
 * COMPACT_SOURCE_ROOT selects baseline sources; dependencies remain in this prepared build copy.
 * PLAYWRIGHT_MODULE and CHROMIUM_PATH select an installed browser runtime.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const sourceRoot = process.env.COMPACT_SOURCE_ROOT || root;
const less = require(path.join(root, 'build/node_modules/less'));

(async () => {
	const lessFile = path.join(root, 'apps/documenteditor/main/resources/less/app.less');
	const shellLess = 'apps/documenteditor/main/resources/less/compact-shell.less';
	// Resolve generated imports in the build copy while selecting the tested shell stylesheet.
	const manager = new less.FileManager();
	const load = manager.loadFile.bind(manager);
	manager.supports = filename => filename.endsWith('compact-shell.less');
	manager.loadFile = async (filename, directory, options, environment) => {
		if (filename.endsWith('compact-shell.less')) {
			return {contents: fs.readFileSync(path.join(sourceRoot, shellLess), 'utf8'),
				filename: path.join(root, shellLess)};
		}
		return load(filename, directory, options, environment);
	};
	const css = await less.render(fs.readFileSync(lessFile, 'utf8'), {filename: lessFile,
		modifyVars: JSON.parse(fs.readFileSync(path.join(root, 'build/documenteditor.json'), 'utf8')).main.less.vars,
		plugins: [{install: (less, pluginManager) => pluginManager.addFileManager(manager)}]});
	const browser = await chromium.launch({headless: true,
		executablePath: process.env.CHROMIUM_PATH || chromium.executablePath()});
	let passed = 0, failed = 0;
	try {
		const page = await browser.newPage({viewport: {width: 1200, height: 700}});
		page.setDefaultTimeout(5000);
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		async function fixture({rtl = false, observer = true, production = false} = {}) {
			await page.goto('about:blank');
			await page.setContent(`<style>${css.css}</style>
				<style>#toolbar{position:absolute;inset:0 0 auto;height:96px}
				.middle{position:absolute;inset:96px 0 0}#viewport-hbox-layout{height:100%}
				#right-menu{height:100%;background:#eee}#first-property{width:40px;height:40px}
				#settings{height:calc(100% - 40px);overflow:auto}#last-property{margin-top:800px}
				#vo-tb .tail-control{width:70px;min-width:70px;height:30px}</style>
				<div id="toolbar" style="height:96px"><div id="vo-shell"><div class="vo-hd"></div><div class="vo-mn"></div>
				<div id="vo-tb"><div class="vo-g"><button class="vo-ib">Undo</button></div>
				<div class="vo-of"><div class="vo-g">${Array.from({length: 12}, (_, i) =>
					`<button class="tail-control">${i}</button>`).join('')}</div></div>
				<span class="vo-more-wrap"><button class="vo-ib">More</button></span>
				<div class="vo-tb-end"><button class="vo-ib">Focus</button></div></div></div></div>
				<div class="middle"><div id="viewport-hbox-layout" class="layout-ct hbox">
				<div id="editor-container" class="layout-item"></div><div id="right-menu" class="layout-item"
				style="width:40px"><button id="first-property">P</button><div id="settings">
				<button id="last-property">Last</button></div></div></div></div>`);
			for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js',
				'vendor/backbone/backbone.js']) await page.addScriptTag({path: path.join(root, file)});
			await page.evaluate(({rtl, observer}) => {
				if (!window.savedResizeObserver) window.savedResizeObserver = window.ResizeObserver;
				window.ResizeObserver = observer ? window.savedResizeObserver : undefined;
				window.DE = {Views: {}, getController: () => ({viewport: {hlayout: window.hlayout}})};
				window.Common = {UI: {isRTL: () => rtl}, NotificationCenter: _.extend({}, Backbone.Events)};
				window.isrtl = rtl;
				window.Asc = {};
				window.define = (dependencies, factory) => {
					window.fixtureModule = factory({svg: () => ''}, window.ToolbarHints);
				};
			}, {rtl, observer});
			await page.addScriptTag({path: path.join(sourceRoot, 'apps/common/main/lib/util/utils.js')});
			const hintsFile = path.join(sourceRoot, 'apps/documenteditor/main/app/view/ToolbarHints.js');
			if (fs.existsSync(hintsFile)) {
				await page.addScriptTag({path: hintsFile});
				await page.evaluate(() => { window.ToolbarHints = window.fixtureModule; });
			}
			for (const file of ['apps/common/main/lib/component/Layout.js',
				'apps/documenteditor/main/app/view/CompactToolbar.js',
				'apps/documenteditor/main/app/view/CompactShell.js',
				// Buttons paired with a menu item run the item of the menu catalog.
				'apps/documenteditor/main/app/view/DocumentActions.js']) {
				await page.addScriptTag({path: path.join(sourceRoot, file)});
			}
			await page.evaluate(({rtl, production}) => {
				document.body.className = 'vo-compact';
				const items = [{el: $('#editor-container'), stretch: true}, {el: $('#right-menu'), rely: true}];
				window.hlayout = new Common.UI.HBoxLayout({box: $('#viewport-hbox-layout'),
					items: rtl ? items.reverse() : items});
				const shell = window.shell = DE.Views.CompactShell;
				DE.Views.SelectionBubble = {};
				DE.Views.CompactWindows = {setActive: () => {}};
				const tb = shell.tb = DE.Views.CompactToolbar;
				if (production) {
					window.commands = [];
					tb.api = {ClearFormating: () => commands.push('clear'),
						SetPaintFormat: () => commands.push('paint')};
					DE.Views.DocumentActions.init(tb.api, shell);
					$('#vo-tb').replaceWith(tb.build());
				} else {
					tb.el = $('#vo-tb'); tb.$of = $('.vo-of'); tb.$moreWrap = $('.vo-more-wrap');
				}
				tb.ctrl = {focus: {toggleClass() { return this; }, attr() { return this; }},
					collapse: {toggleClass: () => {}}};
				shell.resync = () => {};
				shell.applyLayout = () => hlayout.doLayout();
				shell.restoreStockLook = shell.ensureBackButton = shell.syncLeftState = () => {};
				shell.bindPropertiesInsets && shell.bindPropertiesInsets();
				shell.toggleRightPanel();
			}, {rtl, production});
			await settle();
		}
		async function settle() {
			await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)))));
		}
		const geometry = () => page.evaluate(() => {
			const rect = id => {
				const r = document.getElementById(id).getBoundingClientRect();
				return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width};
			};
			const first = rect('first-property');
			const hit = document.elementFromPoint((first.left + first.right) / 2, (first.top + first.bottom) / 2);
			return {bar: rect('vo-tb'), panel: rect('right-menu'), first,
				hit: hit && hit.id, shell: rect('vo-shell'),
				collapsed: document.querySelectorAll('.tail-control.vo-collapsed').length};
		});
		async function clearOfPanel(rtl = false) {
			const g = await geometry();
			assert(rtl ? g.bar.left >= g.panel.right : g.bar.right <= g.panel.left,
				`toolbar overlaps properties: ${JSON.stringify(g)}`);
			assert.equal(g.hit, 'first-property', 'top property receives mouse input');
			await page.locator('#first-property').click();
			await page.locator('#first-property').focus();
			assert.equal(await page.evaluate(() => document.activeElement.id), 'first-property');
		}
		async function check(name, run) {
			try { await run(); console.log('PASS', name); passed++; }
			catch (error) { console.error('FAIL', name, error.message); failed++; }
		}
		await check('visible rail excludes toolbar and receives input', async () => {
			await fixture(); await clearOfPanel();
		});
		await check('expanded properties and resize keep adaptive controls reachable', async () => {
			await fixture();
			await page.evaluate(() => {
				$('#right-menu').width(320); hlayout.doLayout();
				Common.NotificationCenter.trigger('layout:changed', 'rightmenu');
			});
			await settle(); await clearOfPanel();
			assert((await geometry()).collapsed > 0, 'production toolbar collapses the tail');
			assert(await page.locator('.vo-more-wrap').isVisible());
			await page.setViewportSize({width: 1024, height: 600});
			await page.evaluate(() => hlayout.doLayout());
			await settle(); await clearOfPanel();
		});
		await check('closing properties restores the full toolbar width', async () => {
			await fixture(); await page.evaluate(() => shell.toggleRightPanel()); await settle();
			const g = await geometry(); assert.equal(g.bar.right, g.shell.right - 20);
		});
		await check('collapsed header, hidden toolbar and view preserve panel height', async () => {
			await fixture();
			const before = (await geometry()).panel;
			// The shell collapses the header and the menu bar: the rows slide away, then one layout pass without them.
			await page.evaluate(() => {
				window.layouts = 0;
				const apply = shell.applyLayout;
				shell.applyLayout = function () { layouts++; return apply.apply(this, arguments); };
				shell.toggleFocus();
			});
			await page.waitForFunction(() => document.body.classList.contains('vo-top-hidden'));
			await settle();
			const rows = () => page.evaluate(() => ({hidden: shell.topHidden(), layouts,
				inert: ['.vo-hd', '.vo-mn'].map(sel => document.querySelector('#vo-shell > ' + sel).inert)}));
			assert.deepEqual(await rows(), {hidden: true, layouts: 1, inert: [true, true]});
			assert.deepEqual((await geometry()).panel, before);
			await clearOfPanel();
			await page.evaluate(() => shell.toggleFocus());
			await settle();
			assert.deepEqual(await rows(), {hidden: false, layouts: 2, inert: [false, false]});
			assert.equal(await page.evaluate(() => document.body.classList.contains('vo-top-hidden')), false);
			assert.deepEqual((await geometry()).panel, before);
			for (const cls of ['vo-tb-hidden', 'vo-view']) {
				await page.evaluate(cls => document.body.classList.add(cls), cls);
				await settle();
				assert.deepEqual((await geometry()).panel, before);
				await page.evaluate(cls => document.body.classList.remove(cls), cls);
			}
			await settle(); await clearOfPanel();
		});
		await check('mode round trip restores owned styles and current geometry', async () => {
			await fixture();
			await page.evaluate(() => shell.toggleMode()); await settle();
			assert.equal(await page.locator('#vo-shell').evaluate(el =>
				el.style.getPropertyValue('--vo-properties-inset-right')), '');
			await page.evaluate(() => shell.toggleMode()); await settle(); await clearOfPanel();
		});
		await check('RTL reserves space at the physical left edge', async () => {
			await fixture({rtl: true}); await clearOfPanel(true);
		});
		await check('fallback updates after layout resize without ResizeObserver', async () => {
			await fixture({observer: false});
			await page.evaluate(() => {
				$('#right-menu').width(280); hlayout.doLayout(); hlayout.trigger('layout:resizedrag');
			});
			await settle(); await clearOfPanel();
			await page.evaluate(() => {
				$('#right-menu').width(360); hlayout.doLayout();
				Common.NotificationCenter.trigger('layout:resizestop');
			});
			await settle(); await clearOfPanel();
		});
		await check('last setting remains reachable in a short window', async () => {
			await fixture(); await page.locator('#last-property').scrollIntoViewIfNeeded();
			await page.locator('#last-property').click(); await page.locator('#last-property').press('Shift+Tab');
			await page.locator('#first-property').press('Tab');
			assert.equal(await page.evaluate(() => document.activeElement.id), 'last-property');
			assert((await page.locator('#settings').evaluate(el => el.scrollTop)) > 0);
		});
		await check('queued measurement cannot reapply styles after Advanced', async () => {
			await fixture();
			await page.evaluate(() => {
				Common.NotificationCenter.trigger('layout:changed', 'rightmenu'); shell.toggleMode();
			});
			await settle();
			assert.equal(await page.locator('#vo-shell').evaluate(el =>
				el.style.getPropertyValue('--vo-properties-inset-right')), '');
		});
		await check('startup rollback releases geometry subscriptions and pending frame', async () => {
			await fixture();
			await page.evaluate(() => {
				const stock = shell.snapshotStock(null);
				stock.heights = []; stock.nodes = $('[id^="vo-"]').toArray();
				Common.NotificationCenter.trigger('layout:changed', 'rightmenu'); shell.rollbackStartup(stock);
				Common.NotificationCenter.trigger('layout:changed', 'rightmenu');
			});
			await settle();
			assert.equal(await page.locator('#vo-shell').evaluate(el =>
				el.style.getPropertyValue('--vo-properties-inset-right')), '');
		});
		for (const rtl of [false, true]) for (const observer of [false, true]) {
			await check(`overflow commands stay reachable (${rtl ? 'RTL' : 'LTR'}, observer=${observer})`, async () => {
				await page.setViewportSize({width: 760, height: 700});
				await fixture({rtl, observer, production: true});
				await page.evaluate(() => {
					$('#right-menu').width(267); hlayout.doLayout();
					Common.NotificationCenter.trigger('layout:changed', 'rightmenu');
				});
				await settle();
				await page.locator('.vo-more').click();
				async function inside() {
					const pop = await page.locator('.vo-of-pop').boundingBox();
					const viewport = page.viewportSize();
					assert(pop && pop.width > 0, 'overflow popup is visible');
					assert(pop.x >= 0 && pop.x + pop.width <= viewport.width,
						`overflow extends beyond viewport: ${JSON.stringify(pop)}`);
					for (const button of await page.locator('.vo-of-pop button:visible').all()) {
						await button.click({trial: true});
					}
				}
				await inside();
				await page.setViewportSize({width: 720, height: 700});
				await settle(); await inside();
				await page.evaluate(() => {
					$('#right-menu').width(320); hlayout.doLayout();
					Common.NotificationCenter.trigger('layout:changed', 'rightmenu');
				});
				await settle(); await inside();
				await page.getByRole('button', {name: 'Clear formatting', exact: true}).click();
				assert.deepEqual(await page.evaluate(() => commands), ['clear']);
				await page.locator('.vo-more').click();
				await inside();
			});
		}
		await check('no frame or observer errors', async () => assert.deepEqual(errors, []));
		console.log(`${passed} passed, ${failed} failed`);
	} finally { await browser.close(); }
	process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
