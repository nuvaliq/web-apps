/* Run: NODE_PATH=<build dependencies> node test/unit-tests/pdfeditor/print-content-layout.cjs
 * Uses the real print panel, ComboBox, Scroller, window and print controller in Chrome.
 * PLAYWRIGHT_MODULE selects Playwright; PDF_PRINT_CSS can select the deployed stylesheet.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./lib/shell-page.cjs');
const P = require('./lib/print-page.cjs');

async function geometry(page) {
    return page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height}; };
        const settings = document.querySelector('.vo-win--print .flex-settings');
        const menu = document.querySelector('#print-combo-content .dropdown-menu');
        const bars = Array.from(settings.querySelectorAll('.ps-scrollbar-y-rail, .ps-scrollbar-y')).map(bar => ({
            rect: rect(bar), owner: rect(bar.parentElement), ownerClass: bar.parentElement.className,
            display: getComputedStyle(bar).display,
            position: getComputedStyle(bar.parentElement).position,
            overflow: getComputedStyle(bar.parentElement).overflow,
            scrollHeight: bar.parentElement.scrollHeight, clientHeight: bar.parentElement.clientHeight
        }));
        const field = document.querySelector('#print-combo-content .form-control');
        return {window: rect(document.querySelector('.vo-win--print')), settings: rect(settings),
            scrollTop: settings.scrollTop, field: rect(field), menu: menu && rect(menu),
            menuBackground: menu && getComputedStyle(menu).backgroundColor,
            menuShadow: menu && getComputedStyle(menu).boxShadow, bars};
    });
}

async function openMenu(page) {
    await page.locator('#print-combo-content .dropdown-toggle').click();
    await page.waitForFunction(() => document.activeElement.matches('#print-combo-content li.selected a'));
    await H.settle(page);
}

function confinedBars(result) {
    assert.ok(result.bars.length > 0, 'the real Scroller must be present');
    for (const bar of result.bars) {
        if (bar.display === 'none' || bar.rect.height === 0) continue;
        assert.ok(bar.rect.top >= bar.owner.top - 1 && bar.rect.bottom <= bar.owner.bottom + 1,
            'scrollbar outside owner: ' + JSON.stringify(bar));
    }
}

(async () => {
    const browser = await H.launch();
    const {check, done} = H.checker();
    try {
        await check('print settings do not leave a scrollbar outside their owner', async () => {
            const page = await P.open(browser);
            try {
                await openMenu(page);
                const result = await geometry(page);
                if (process.env.TEST_OUTPUT_DIR) {
                    fs.mkdirSync(process.env.TEST_OUTPUT_DIR, {recursive: true});
                    fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, 'print-geometry.json'), JSON.stringify(result, null, 2));
                    await page.screenshot({path: path.join(process.env.TEST_OUTPUT_DIR, 'print-content.png')});
                }
                confinedBars(result);
                assert.equal(result.scrollTop, 0, 'focusing the list must not scroll away the settings');
                assert.ok(Math.abs(result.field.width - result.menu.width) <= 1);
                assert.equal(result.menuBackground, 'rgb(255, 255, 255)');
                assert.notEqual(result.menuShadow, 'none');
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('the list fits the editor viewport at supported window sizes', async () => {
            for (const [width, height] of [[1440, 900], [1024, 768], [1280, 720], [1024, 576]]) {
                const page = await P.open(browser, {width, height, locale: 'ru'});
                try {
                    await openMenu(page);
                    const result = await geometry(page);
                    confinedBars(result);
                    assert.equal(result.scrollTop, 0);
                    assert.ok(result.menu.top >= 0 && result.menu.bottom <= height);
                    assert.ok(result.field.top >= result.settings.top && result.field.bottom <= result.settings.bottom + 1);
                    assert.ok(result.window.top >= 0 && result.window.bottom <= height);
                    assert.deepEqual(page.errors, []);
                } finally { await page.close(); }
            }
        });

        await check('mouse selection preserves all four print-content values without starting printing', async () => {
            const page = await P.open(browser);
            try {
                for (const value of [0, 1, 2, 3]) {
                    await openMenu(page);
                    await page.locator('#print-combo-content li[data-value="' + value + '"] a').click();
                    assert.deepEqual(await page.evaluate(() => ({
                        selected: printFixture.panel.cmbContent.getValue(),
                        parameter: printFixture.controller.adjPrintParams.content,
                        actions: printFixture.calls.length
                    })), {selected: value, parameter: value, actions: 0});
                }
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('Enter selects and Escape closes the list without pressing the primary button', async () => {
            const page = await P.open(browser);
            try {
                await openMenu(page);
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Enter');
                await H.settle(page);
                assert.equal(await page.evaluate(() => printFixture.panel.cmbContent.getValue()), 2);
                assert.equal(await page.locator('#print-combo-content .combobox.open').count(), 0);
                await openMenu(page);
                await page.keyboard.press('Escape');
                await H.settle(page);
                assert.equal(await page.locator('#print-combo-content .combobox.open').count(), 0);
                assert.equal(await page.locator('.vo-win--print:visible').count(), 1);
                assert.deepEqual(await page.evaluate(() => printFixture.calls), []);
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('both footer actions pass the selected content to the real print controller exactly once', async () => {
            const page = await P.open(browser);
            try {
                let count = 0;
                for (const action of ['print', 'pdf']) {
                    for (const value of [0, 1, 2, 3]) {
                        if (count) await page.evaluate(() => printFixture.open());
                        await openMenu(page);
                        await page.locator('#print-combo-content li[data-value="' + value + '"] a').click();
                        await page.locator('.vo-win--print > .body > .footer [result="' + action + '"]').click();
                        count++;
                        const calls = await page.evaluate(() => printFixture.calls);
                        assert.equal(calls.length, count);
                        assert.deepEqual(calls[count - 1], {action, content: value});
                        assert.equal(await page.locator('.vo-win--print:visible').count(), 0);
                    }
                }
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('resize closes the list without losing the value or leaving stray scrollbars', async () => {
            const page = await P.open(browser);
            try {
                await openMenu(page);
                await page.setViewportSize({width: 1024, height: 576});
                await page.evaluate(() => printFixture.resize());
                await H.settle(page);
                assert.equal(await page.evaluate(() => printFixture.panel.cmbContent.getValue()), 1);
                assert.equal(await page.locator('#print-combo-content .combobox.open').count(), 0);
                await openMenu(page);
                confinedBars(await geometry(page));
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('wheeling over an open list does not leave an idle settings scrollbar after Escape', async () => {
            const page = await P.open(browser);
            try {
                await openMenu(page);
                await page.locator('#print-combo-content .dropdown-toggle').hover();
                await page.mouse.wheel(0, 40);
                await H.settle(page);
                await page.keyboard.press('Escape');
                await H.settle(page);
                const bars = page.locator('.vo-win--print .flex-settings > .ps-scrollbar-y-rail');
                assert.equal(await bars.count(), 1);
                assert.equal(await bars.isVisible(), false, 'the auto-height settings must not show a scrollbar for the closed popup');
                assert.equal(await page.evaluate(() => printFixture.panel.pnlSettings[0].scrollTop), 0);
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('a constrained dropdown scrolls its own items without scrolling the settings', async () => {
            const page = await P.open(browser);
            try {
                await page.evaluate(() => {
                    printFixture.panel.cmbContent.cmpEl.find('.dropdown-menu').css('max-height', '90px');
                });
                await openMenu(page);
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('ArrowDown');
                await H.settle(page);
                const result = await geometry(page);
                confinedBars(result);
                assert.equal(result.scrollTop, 0);
                const focus = await page.evaluate(() => {
                    const menu = document.querySelector('#print-combo-content .dropdown-menu');
                    const active = document.activeElement.getBoundingClientRect();
                    const list = menu.getBoundingClientRect();
                    return {scrollTop: menu.scrollTop, visible: active.top >= list.top && active.bottom <= list.bottom};
                });
                assert.ok(focus.scrollTop > 0 && focus.visible);
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => printFixture.panel.cmbContent.getValue()), 3);
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('the local adaptation leaves the stock panel and its menu intact after closing', async () => {
            const page = await P.open(browser);
            try {
                await openMenu(page);
                await page.keyboard.press('Escape');
                await page.evaluate(() => {
                    printFixture.close();
                    document.body.classList.remove('vo-compact');
                    document.getElementById('file-menu-panel').style.display = 'block';
                    printFixture.panel.show();
                });
                assert.deepEqual(await page.evaluate(() => ({
                    parent: printFixture.panel.el.parentElement.id,
                    menuRestored: printFixture.panel.menu === printFixture.fileMenu,
                    overflow: getComputedStyle(printFixture.panel.pnlSettings[0]).overflow
                })), {parent: 'file-menu-panel', menuRestored: true, overflow: 'hidden'});
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('the scrollbar correction preserves the current dark-theme surfaces', async () => {
            const page = await P.open(browser, {theme: 'theme-dark'});
            try {
                await openMenu(page);
                const result = await geometry(page);
                confinedBars(result);
                assert.equal(result.scrollTop, 0);
                assert.equal(result.menuBackground, await page.locator('.vo-win--print').evaluate(node => getComputedStyle(node).backgroundColor));
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });

        await check('print permission still prevents opening the adapted window', async () => {
            const page = await P.open(browser, {canPrint: false});
            try {
                assert.equal(await page.locator('.asc-window').count(), 0);
                assert.deepEqual(page.errors, []);
            } finally { await page.close(); }
        });
    } finally { await browser.close(); }
    done();
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
