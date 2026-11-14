/* Run after the document editor LESS build: node test/unit-tests/documenteditor/compact-menu-layers.cjs
 * COMPACT_CSS selects a compiled stylesheet for baseline/candidate comparisons.
 * Browser hit testing covers the production stacking contexts; SDK selection is checked in a live document.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const cssFile = process.env.COMPACT_CSS ||
	path.join(root, 'deploy/web-apps/apps/documenteditor/main/resources/css/app.css');
const css = fs.readFileSync(cssFile, 'utf8');

(async () => {
	const browser = await chromium.launch(process.env.CHROMIUM_PATH ?
		{headless: true, executablePath: process.env.CHROMIUM_PATH} : {headless: true, channel: 'chrome'});
	let passed = 0, failed = 0;
	try {
		const page = await browser.newPage({viewport: {width: 1200, height: 700}});
		async function fixture(kind, scrolled = false) {
			await page.goto('about:blank');
			await page.setContent(`<!doctype html><style>${css}</style><style>
				#toolbar {position:absolute;top:0;left:0;width:100%}
				#vo-shell {position:relative;height:300px}
				.vo-hd,.vo-mn,#vo-tb {height:40px;overflow:visible}
				#vo-tb {margin:0;top:0}
				#popup,#other-menu {position:fixed;left:100px;top:140px;width:350px;height:180px;
					display:block;animation:none;transform:none}
				#popup button {display:block;width:100%;height:60px}
				#vo-bubble {position:fixed;left:160px;top:180px;width:250px;height:42px;
					display:flex;animation:none;transform:none}
				#vo-bubble button {width:100%;height:100%}
			</style><body class="vo-compact${scrolled ? ' vo-scrolled' : ''}">
				<div id="toolbar" class="layout-item"><div id="vo-shell">
				<div class="vo-hd"></div><div class="vo-mn"></div>
				<div id="vo-tb"><div class="vo-of"><div class="vo-g"></div></div>
				<div class="vo-more-wrap"></div></div></div></div>
				<div id="vo-bubble" class="open"><button type="button">Bold</button></div></body>`);
			for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js']) {
				await page.addScriptTag({path: path.join(root, file)});
			}
			await page.evaluate(() => { window.define = (dependencies, factory) => factory({}); });
			await page.addScriptTag({path: path.join(root, 'apps/documenteditor/main/app/view/SelectionBubble.js')});
			await page.evaluate(() => {
				const bubble = DE.Views.SelectionBubble;
				bubble.$el = $('#vo-bubble');
				if (bubble.bindMenuLayer) bubble.bindMenuLayer();
			});
			await page.evaluate(kind => {
				const popup = document.createElement('div');
				popup.id = 'popup';
				popup.innerHTML = '<button type="button">First</button>' +
					'<button type="button" id="command">Covered command</button>' +
					'<button type="button">Last</button>';
				if (kind === 'header') {
					popup.className = 'vo-mn-drop open';
					document.querySelector('.vo-mn').appendChild(popup);
				} else if (kind === 'overflow') {
					popup.className = 'vo-of-pop';
					document.querySelector('#vo-tb').classList.add('vo-of-open');
					document.querySelector('.vo-more-wrap').appendChild(popup);
				} else {
					const wrap = document.createElement('div');
					wrap.className = kind === 'combo' ? 'vo-cb open' : 'vo-pop-wrap open';
					popup.className = kind === 'combo' ? 'vo-cb-pop' : 'vo-pop';
					wrap.appendChild(popup);
					if (kind === 'nested') {
						const overflow = document.createElement('div');
						overflow.className = 'vo-of-pop';
						overflow.appendChild(wrap);
						document.querySelector('#vo-tb').classList.add('vo-of-open');
						document.querySelector('.vo-more-wrap').appendChild(overflow);
					} else document.querySelector('.vo-g').appendChild(wrap);
				}
				window.hits = {command: 0, bubble: 0};
				document.querySelector('#command').onclick = () => hits.command++;
				document.querySelector('#vo-bubble button').onclick = () => hits.bubble++;
				// Backdrop filters change the containing block of fixed descendants.
				const command = document.querySelector('#command').getBoundingClientRect();
				const bubble = document.querySelector('#vo-bubble');
				bubble.style.left = command.left + 20 + 'px';
				bubble.style.top = command.top + 5 + 'px';
			}, kind);
		}
		async function closeMenus() {
			await page.evaluate(() => {
				document.querySelectorAll('#vo-shell .open').forEach(node => node.classList.remove('open'));
				document.querySelector('#vo-tb').classList.remove('vo-of-open');
				document.querySelector('#popup').remove();
			});
		}
		async function menuReceivesClick() {
			const point = await page.evaluate(() => {
				const bubble = document.querySelector('#vo-bubble').getBoundingClientRect();
				const command = document.querySelector('#command').getBoundingClientRect();
				const left = Math.max(bubble.left, command.left), right = Math.min(bubble.right, command.right);
				const top = Math.max(bubble.top, command.top), bottom = Math.min(bubble.bottom, command.bottom);
				return {x: (left + right) / 2, y: (top + bottom) / 2,
					overlap: right > left && bottom > top};
			});
			assert(point.overlap, 'visible menu command must intersect the visible selection toolbar');
			assert(await page.locator('#vo-bubble').isVisible(), 'selection toolbar must remain visible');
			assert.equal(await page.evaluate(({x, y}) => document.elementFromPoint(x, y).id, point), 'command');
			await page.mouse.click(point.x, point.y);
			assert.deepEqual(await page.evaluate(() => hits), {command: 1, bubble: 0});
			await closeMenus();
			assert.equal(await page.locator('#vo-bubble').getAttribute('class'), 'open');
			const button = await page.locator('#vo-bubble button').boundingBox();
			await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
			assert.deepEqual(await page.evaluate(() => hits), {command: 1, bubble: 1});
		}
		async function check(name, fn) {
			try { await fn(); console.log('PASS', name); passed++; }
			catch (error) { console.error('FAIL', name, error.message); failed++; }
		}
		for (const width of [1200, 900]) {
			await page.setViewportSize({width, height: 700});
			for (const kind of ['header', 'formatting', 'combo', 'overflow', 'nested']) {
				await check(`${kind}: visible menu receives one click, toolbar usable after close (${width})`,
					async () => { await fixture(kind); await menuReceivesClick(); });
			}
		}
		await check('scrolled toolbar menu stays above selection toolbar', async () => {
			await fixture('formatting', true);
			await menuReceivesClick();
		});
		await check('header menus remain above formatting menus', async () => {
			await fixture('formatting');
			await page.evaluate(() => {
				const menu = document.createElement('div');
				menu.id = 'other-menu'; menu.className = 'vo-mn-drop open';
				document.querySelector('.vo-mn').appendChild(menu);
				const command = document.querySelector('#command').getBoundingClientRect();
				menu.style.left = command.left + 'px';
				menu.style.top = command.top + 'px';
			});
			assert.equal(await page.evaluate(() => {
				const command = document.querySelector('#command').getBoundingClientRect();
				return document.elementFromPoint(command.left + 30, command.top + 20).id;
			}), 'other-menu');
		});
		await check('open menus keep selection toolbar below standard tooltip, modal and loading-mask layers', async () => {
			await fixture('formatting');
			const z = await page.evaluate(() => {
				const bubble = Number(getComputedStyle(document.querySelector('#vo-bubble')).zIndex);
				return {bubble, toolbar: Number(getComputedStyle(document.querySelector('#toolbar')).zIndex)};
			});
			assert(z.bubble > 2, 'selection toolbar must stay above the document canvas layers');
			assert(z.bubble < z.toolbar, 'selection toolbar must stay below the entire formatting context');
			for (const name of ['tooltip', 'asc-window', 'asc-loadmask']) {
				const zIndex = await page.evaluate(name => {
					const node = document.createElement('div'); node.className = name;
					document.body.appendChild(node);
					return Number(getComputedStyle(node).zIndex);
				}, name);
				assert(zIndex > z.bubble, `${name} must stay above selection toolbar`);
			}
		});
		await check('closed menus leave selection controls accessible above the persistent toolbar', async () => {
			await fixture('formatting');
			await closeMenus();
			await page.evaluate(() => {
				const toolbar = document.querySelector('#vo-tb').getBoundingClientRect();
				const bubble = document.querySelector('#vo-bubble');
				bubble.style.left = toolbar.left + 60 + 'px';
				bubble.style.top = toolbar.top + 5 + 'px';
			});
			const box = await page.locator('#vo-bubble button').boundingBox();
			const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
			assert(await page.evaluate(({x, y}) =>
				document.querySelector('#vo-bubble button').contains(document.elementFromPoint(x, y)), point));
			await page.mouse.click(point.x, point.y);
			assert.deepEqual(await page.evaluate(() => hits), {command: 0, bubble: 1});
		});
		await check('switching and rebuilding menus restores the layer after the last menu closes', async () => {
			await fixture('header');
			for (let i = 0; i < 3; i++) {
				await page.evaluate(() => {
					const menu = document.createElement('div');
					menu.id = 'second-menu'; menu.className = 'vo-cb open';
					document.querySelector('#vo-tb').appendChild(menu);
					document.querySelector('#popup').classList.remove('open');
				});
				assert.equal(await page.locator('#vo-bubble').getAttribute('class'), 'open vo-under-menu');
				await page.locator('#second-menu').evaluate(node => node.remove());
				assert.equal(await page.locator('#vo-bubble').getAttribute('class'), 'open');
				await page.locator('#popup').evaluate(node => node.classList.add('open'));
				assert.equal(await page.locator('#vo-bubble').getAttribute('class'), 'open vo-under-menu');
			}
		});
		await check('closed-menu selection controls preserve the tooltip and modal priorities', async () => {
			await fixture('formatting');
			await closeMenus();
			const priorities = await page.evaluate(() => {
				return ['#vo-bubble', '.tooltip', '.asc-window', '.asc-loadmask'].map(selector => {
					let node = document.querySelector(selector);
					if (!node) {
						node = document.createElement('div'); node.className = selector.slice(1);
						document.body.appendChild(node);
					}
					return Number(getComputedStyle(node).zIndex);
				});
			});
			assert(priorities.slice(1).every(value => value > priorities[0]));
		});
		console.log(`${passed} passed, ${failed} failed`);
		if (failed) process.exitCode = 1;
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
