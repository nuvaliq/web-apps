/* Run: node test/unit-tests/documenteditor/selection-bubble-search.cjs
 * Production AMD views/controllers and browser event propagation; the document SDK is a fixture boundary.
 * PLAYWRIGHT_MODULE selects an installed Playwright package. TEST_BASELINE checks production files at a ref.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const root = path.resolve(__dirname, '../../..');

(async () => {
    const options = {headless: true};
    if (engine === 'chromium' && process.env.CHROMIUM_PATH) {
        options.executablePath = process.env.CHROMIUM_PATH;
    }
    const browser = await playwright[engine].launch(options);
    let passed = 0, failed = 0;
    async function fixture() {
        const page = await browser.newPage();
        page.fixtureErrors = [];
        page.on('pageerror', error => page.fixtureErrors.push(error.message));
        await page.setContent(`<style>#editor_sdk{position:absolute;left:40px;top:100px;width:600px;height:300px}
            #id_main_view,#id_viewer_overlay{width:100%;height:100%}#vo-bubble{position:absolute}</style>
            <input id="query"><div id="results"></div><div id="editor_sdk">
            <div id="id_main_view"><canvas id="id_viewer_overlay"></canvas></div><div id="id_vertical_scroll">Scroll</div></div>
            <div id="area_id_main"><textarea id="area_id"></textarea></div><button id="outside">Outside</button>`);
        for (const file of ['vendor/jquery/jquery.js', 'vendor/underscore/underscore.js', 'vendor/backbone/backbone.js']) {
            await page.addScriptTag({path: path.join(root, file)});
        }
        await page.evaluate(() => {
            window.DE = {Views: {}, Controllers: {}, getController: () => ({appOptions: {}})};
            Backbone.Controller = Backbone.View;
            window.Common = {NotificationCenter: _.extend({}, Backbone.Events),
                UI: {Keys: {RETURN: 13}}, Utils: {String: {htmlEncode: text => text}}};
            window.Asc = {c_oAscTypeSelectElement: {Paragraph: 0, Table: 1, Image: 2, Shape: 3, Chart: 4, Math: 5}};
            window.AscCommon = {IsPunctuation: () => false, CSearchSettings: function () {
                this.put_Text = value => {this.text = value;};
                this.put_MatchCase = () => {}; this.put_WholeWords = () => {};
            }};
            window.define = (deps, factory) => factory({svg: () => '<svg width="20" height="20"></svg>'});
        });
        for (const file of ['apps/documenteditor/main/app/view/SelectionBubble.js',
            'apps/documenteditor/main/app/controller/Search.js',
            'apps/documenteditor/main/app/view/DocumentActions.js']) {
            const content = process.env.TEST_BASELINE ?
                execFileSync('git', ['show', `${process.env.TEST_BASELINE}:${file}`], {cwd: root, encoding: 'utf8'}) :
                fs.readFileSync(path.join(root, file), 'utf8');
            await page.addScriptTag({content});
        }
        await page.evaluate(() => {
            const callbacks = {};
            const state = window.state = {selected: false, type: 0, found: true, index: -1,
                finds: 0, selections: 0, selectAllCalls: 0, highlights: [], copyQueries: 0, bold: false, dragging: false};
            const emit = (name, ...args) => (callbacks[name] || []).slice().forEach(fn => fn(...args));
            const focus = window.focusSelection = () => emit('asc_onFocusObject', api.getSelectedElements());
            const restoreSelection = () => {state.selected = true; focus();};
            const selectResult = index => {
                state.selected = true;
                state.type = 0;
                state.index = index;
                emit('asc_onSetSearchCurrent', index, 3);
                focus();
            };
            const api = window.api = {
                WordControl: {
                    m_oLogicDocument: {DrawingObjects: {
                        getSelectedArray: () => [{Get_Id: () => 'drawing', selectStartPage: 0}],
                        getSelectedObjectsBounds: () => ({minX: 100, minY: 100, maxX: 200, maxY: 140, pageIndex: 0})
                    }},
                    m_oDrawingDocument: {m_arrPages: [{}], ConvertCoordsToCursor: (x, y) => ({X: x, Y: y})}
                },
                asc_StartTextAroundSearch: () => {},
                asc_registerCallback: (name, fn) => {(callbacks[name] ||= []).push(fn);},
                asc_unregisterCallback: (name, fn) => {
                    callbacks[name] = callbacks[name].filter(callback => callback !== fn);
                },
                getSelectedElements: () => [{get_ObjectType: () => state.type, get_ObjectValue: () => ({})}],
                can_CopyCut: () => {state.copyQueries++; return state.selected;},
                asc_GetSelectionBounds: () => [[100, 120], [state.selectionEnd || 200, 140]],
                Undo: restoreSelection,
                Redo: restoreSelection,
                put_TextPrBold: value => {state.bold = value; focus();},
                asc_findText: (settings, next) => {
                    state.finds++;
                    if (state.found) selectResult((state.index + (next ? 1 : 2)) % 3);
                    return state.found;
                },
                asc_SelectSearchElement: id => {
                    state.selections++;
                    selectResult(id);
                },
                asc_GetErrorForReplaceString: () => '',
                asc_replaceText: (settings, replacement, all) => {
                    state.replacement = [settings.text, replacement, all];
                    selectResult((state.index + 1) % 3);
                    return true;
                },
                asc_EditSelectAll: () => {state.selectAllCalls++; state.selected = true; focus();},
                asc_selectSearchingResults: value => {state.highlights.push(value); focus();},
                asc_endFindText: () => {state.selected = false; focus();}
            };
            DE.Views.CompactShell = {advanced: false, canUse: () => false, editingLocked: () => !!state.locked};
            const bubble = window.bubble = DE.Views.SelectionBubble.create(api, {});
            const controller = window.search = Object.create(DE.Controllers.Search.prototype);
            controller.setApi(api);
            controller._state = {searchText: 'alpha', matchCase: false, matchWord: false, currentResult: 0};
            controller.view = {$el: $('#query'), $resultsContainer: $('#results'),
                updateResultsNumber: () => {}, disableNavButtons: () => {}, disableReplaceButtons: () => {},
                updateScrollers: () => {}, chMatchWord: {isDisabled: () => false, setDisabled: () => {}}};
            controller.scrollToSelectedResult = () => {};
            controller.getApplication = () => ({getController: name => name === 'LeftMenu' ?
                {isSearchPanelVisible: () => false} : {isSearchBarVisible: () => false}});
            window.searchViews = {'SearchBar': _.extend({}, Backbone.Events),
                'Common.Views.SearchPanel': _.extend({}, Backbone.Events), 'LeftMenu': _.extend({}, Backbone.Events)};
            controller.addListeners = map => Object.keys(map).forEach(view =>
                Object.keys(map[view]).forEach(event => searchViews[view].on(event, map[view][event])));
            controller.initialize();
            const actions = DE.Views.DocumentActions.init(api, DE.Views.CompactShell);
            window.historyCommand = name => actions.command('edit.' + name).run();
            const selectAll = actions.command('edit.selectAll');
            $('<button id="select-all"></button>').text(selectAll.t).on('click', () => selectAll.run()).appendTo('body');
            const canvas = document.getElementById('id_viewer_overlay');
            canvas.addEventListener('pointerdown', e => {state.dragging = true; state.selected = false; e.preventDefault(); e.stopPropagation();});
            document.addEventListener('pointerup', () => {
                if (state.dragging) {state.dragging = false; state.selected = state.emptyGesture !== true; focus();}
            });
            canvas.addEventListener('dblclick', () => {state.selected = true; focus();});
            document.getElementById('area_id').addEventListener('keydown', e => {
                if (state.index >= 0) emit('asc_onSetSearchCurrent', -1, 3);
                if ((e.ctrlKey || e.metaKey) && e.keyCode === 65) api.asc_EditSelectAll();
                else if (e.shiftKey && /^(Arrow|Home|End|Page)/.test(e.key)) {
                    state.selected = true; focus();
                }
                e.stopPropagation();
            });
            window.manual = () => {canvas.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerId: 1}));
                canvas.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, pointerId: 1}));};
            window.query = direction => controller.onQuerySearch(direction, true);
            window.resultList = restored => {
                controller._state.isStartedAddingResults = true;
                controller.onApiGetTextAroundSearch([[0, ['a', 'alpha', 'b']], [1, ['a', 'alpha', 'b']]]);
                if (restored) {controller.onHidePanel(); controller.onShowPanel();}
            };
        });
        return page;
    }
    async function check(name, run) {
        const page = await fixture();
        try {await run(page); assert.deepEqual(page.fixtureErrors, []); passed++; console.log('PASS', name);} catch (error) {
            failed++; console.error('FAIL', name, error.stack);
        } finally {await page.close();}
    }
    async function open(page, expected) {
        await page.waitForTimeout(40);
        assert.equal(await page.evaluate(() => bubble.isOpen()), expected);
    }
    try {
        await check('initial focus without a selection does not open the text bubble', async page => {
            await page.evaluate(() => focusSelection()); await open(page, false);
        });
        for (const name of ['undo', 'redo']) {
            await check(name + ' restores the text bubble outside search', async page => {
                await page.evaluate(name => historyCommand(name), name); await open(page, true);
            });
        }
        await check('manual selection before any search opens and formats', async page => {
            await page.evaluate(() => manual()); await open(page, true);
            await page.locator('#vo-bubble button').first().click();
            assert.equal(await page.evaluate(() => state.bold), true); await open(page, true);
        });
        for (const direction of ['next', 'back']) {
            await check(`search ${direction} hides an existing manual bubble`, async page => {
                await page.evaluate(() => manual()); await open(page, true);
                await page.evaluate(d => query(d), direction);
                assert.equal(await page.evaluate(() => bubble.isOpen()), false);
                await open(page, false);
                assert.equal(await page.evaluate(() => state.selected), true);
            });
        }
        await check('a replacement SDK does not inherit search selection suppression', async page => {
            await page.evaluate(() => query()); await open(page, false);
            await page.evaluate(() => {bubble.create({...api}); api.asc_EditSelectAll();}); await open(page, true);
            assert.equal(await page.locator('#vo-bubble').count(), 1);
        });
        await check('single replace hides the manual bubble on the next match', async page => {
            await page.evaluate(() => {query(); manual();}); await open(page, true);
            await page.evaluate(() => searchViews['Common.Views.SearchPanel'].trigger('search:replace', 'alpha', 'beta'));
            assert.equal(await page.evaluate(() => bubble.isOpen()), false);
            await open(page, false);
            assert.deepEqual(await page.evaluate(() => [state.replacement, state.index, state.selected]),
                [['alpha', 'beta', false], 1, true]);
            await page.evaluate(() => manual()); await open(page, true);
        });
        for (const view of ['SearchBar', 'Common.Views.SearchPanel']) {
            await check(`query input goes through its controller listener: ${view}`, async page => {
                await page.evaluate(view => {
                    manual(); search._state.searchText = 'old'; searchViews[view].trigger('search:input', 'alpha');
                }, view);
                await page.waitForTimeout(480); await open(page, false);
                assert.equal(await page.evaluate(() => state.finds), 1);
                await page.evaluate(view => searchViews[view].trigger('search:keydown', 'alpha', {keyCode: 13}), view);
                await open(page, false); assert.equal(await page.evaluate(() => state.finds), 2);
                await page.evaluate(view => searchViews[view].trigger('search:input', ''), view);
                await page.waitForTimeout(480); await open(page, false);
                assert.equal(await page.evaluate(() => state.selected), false);
            });
        }
        await check('double click authorizes a fresh manual selection', async page => {
            await page.evaluate(() => query()); await page.locator('#id_viewer_overlay').dblclick(); await open(page, true);
        });
        await check('repeated searches retain result selection and navigation', async page => {
            await page.evaluate(() => {query('next'); query('next'); query('back');});
            await open(page, false);
            assert.deepEqual(await page.evaluate(() => [state.finds, state.index, state.selected]), [3, 0, true]);
        });
        for (const restored of [false, true]) {
            await check(`result list selection suppresses the bubble, restored=${restored}`, async page => {
                await page.evaluate(restored => resultList(restored), restored);
                await page.locator('#results .item').last().click(); await open(page, false);
                assert.equal(await page.evaluate(() => state.index), 1);
            });
        }
        await check('manual selection after search opens even at identical bounds', async page => {
            await page.evaluate(() => {query(); manual();}); await open(page, true);
            await page.evaluate(() => query()); await open(page, false);
            await page.evaluate(() => manual()); await open(page, true);
        });
        await check('drag ending outside the canvas is a manual selection', async page => {
            await page.evaluate(() => {
                query();
                document.getElementById('id_viewer_overlay').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerId: 1}));
                document.getElementById('outside').dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, pointerId: 1}));
            }); await open(page, true);
        });
        for (const key of ['Shift+ArrowRight', 'Shift+ArrowLeft', 'Shift+ArrowUp', 'Shift+ArrowDown',
            'Shift+Home', 'Shift+End', 'Control+a', 'Meta+a']) {
            await check(`manual keyboard selection through the SDK input: ${key}`, async page => {
                await page.evaluate(() => query()); await page.locator('#area_id').focus();
                await page.keyboard.press(key); await open(page, true);
            });
        }
        await check('keyboard selection works before the first search', async page => {
            await page.locator('#area_id').focus(); await page.keyboard.press('Shift+ArrowRight'); await open(page, true);
        });
        for (const modifier of ['ctrlKey', 'metaKey']) {
            for (const afterSearch of [false, true]) {
                await check(`select all with a Cyrillic key: ${modifier}, afterSearch=${afterSearch}`, async page => {
                    if (afterSearch) await page.evaluate(() => query());
                    await page.locator('#area_id').focus();
                    await page.dispatchEvent('#area_id', 'keydown', {key: 'ф', code: 'KeyA', keyCode: 65,
                        which: 65, [modifier]: true, bubbles: true});
                    await open(page, true);
                    assert.equal(await page.evaluate(() => state.selectAllCalls), 1);
                });
            }
        }
        for (const afterSearch of [false, true]) {
            await check(`manual Select All menu command opens the bubble, afterSearch=${afterSearch}`, async page => {
                if (afterSearch) await page.evaluate(() => query());
                await page.locator('#select-all').click(); await open(page, true);
                assert.equal(await page.evaluate(() => state.selectAllCalls), 1);
            });
        }
        await check('Select All menu command restores a dismissed selection at the same bounds', async page => {
            await page.evaluate(() => manual()); await open(page, true);
            await page.evaluate(() => bubble.dismiss()); await open(page, false);
            await page.locator('#select-all').click(); await open(page, true);
        });
        await check('programmatic Select All cannot authorize a search selection', async page => {
            await page.evaluate(() => {query(); api.asc_EditSelectAll();}); await open(page, false);
        });
        await check('Select All menu command preserves the editing lock', async page => {
            await page.evaluate(() => {query(); state.locked = true;});
            await page.locator('#select-all').click(); await open(page, false);
        });
        await check('shortcuts in the query input cannot authorize the bubble', async page => {
            await page.evaluate(() => query()); await page.locator('#query').focus();
            await page.keyboard.press('Control+a'); await page.keyboard.press('Shift+ArrowRight');
            await page.evaluate(() => focusSelection()); await open(page, false);
        });
        await check('Enter release and focus changes cannot revive a search selection', async page => {
            await page.evaluate(() => query()); await page.locator('#area_id').focus();
            await page.keyboard.press('Enter'); await page.keyboard.press('Shift+Enter');
            await page.keyboard.press('Tab'); await page.evaluate(() => focusSelection()); await open(page, false);
        });
        await check('closing search preserves highlights API and does not show the bubble', async page => {
            await page.evaluate(() => {query(); search.onSelectSearchingResults(true); search.onSelectSearchingResults(false);});
            await open(page, false); assert.deepEqual(await page.evaluate(() => state.highlights), [true, false]);
        });
        await check('clearing the search selection allows a later undo to show the bubble', async page => {
            await page.evaluate(() => {
                search._state.newSearchText = 'alpha';
                query();
                searchViews.SearchBar.trigger('search:input', '');
            });
            await page.waitForTimeout(480);
            await open(page, false);
            assert.equal(await page.evaluate(() => state.selected), false);
            await page.evaluate(() => historyCommand('undo')); await open(page, true);
        });
        await check('a query without matches leaves the manual selection intact', async page => {
            await page.evaluate(() => manual()); await open(page, true);
            await page.evaluate(() => {state.found = false; query();}); await open(page, true);
            assert.equal(await page.evaluate(() => state.selected), true);
        });
        await check('a new search cancels a queued manual refresh', async page => {
            await page.evaluate(() => {manual(); query(); focusSelection();}); await open(page, false);
        });
        await check('a later manual selection survives delayed focus callbacks', async page => {
            await page.evaluate(() => {query(); manual(); focusSelection();}); await open(page, true);
        });
        await check('right click does not make a current search result show the bubble', async page => {
            await page.evaluate(() => {query();
                const c = document.getElementById('id_viewer_overlay');
                c.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 2, pointerId: 1}));
                c.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 2, pointerId: 1})); focusSelection();});
            await open(page, false);
        });
        await check('an empty click hides the bubble without suppressing a later SDK selection', async page => {
            await page.evaluate(() => {query(); state.emptyGesture = true; manual();}); await open(page, false);
            await page.evaluate(() => api.asc_EditSelectAll()); await open(page, true);
        });
        await check('scrollbar and ruler gestures cannot authorize a search selection', async page => {
            await page.evaluate(() => {query();
                const scroll = document.getElementById('id_vertical_scroll');
                scroll.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerId: 1}));
                scroll.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, pointerId: 1}));
                focusSelection();
            }); await open(page, false);
        });
        await check('canceled pointer selection does not leave manual permission', async page => {
            await page.evaluate(() => {query(); const c = document.getElementById('id_viewer_overlay');
                c.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerId: 1}));
                c.dispatchEvent(new PointerEvent('pointercancel', {bubbles: true, pointerId: 1}));
                state.dragging = false; state.selected = true; focusSelection();}); await open(page, false);
        });
        await check('Escape stays dismissed until another manual selection', async page => {
            await page.evaluate(() => manual()); await open(page, true);
            await page.evaluate(() => {bubble.dismiss(); focusSelection();}); await open(page, false);
            await page.evaluate(() => manual()); await open(page, true);
        });
        await check('Shift navigation after Escape only reopens for changed selection bounds', async page => {
            await page.locator('#area_id').focus();
            await page.keyboard.down('Shift');
            await page.keyboard.press('ArrowRight');
            await open(page, true);
            await page.evaluate(() => bubble.dismiss());
            await page.keyboard.press('ArrowRight');
            await open(page, false);
            await page.evaluate(() => {state.selectionEnd = 220;});
            await page.keyboard.press('ArrowRight');
            await open(page, true);
            await page.keyboard.up('Shift');
        });
        for (const type of [1, 2]) {
            await check(`object bubble is independent of search suppression: type=${type}`, async page => {
                await page.evaluate(type => {query(); state.type = type; focusSelection();}, type); await open(page, true);
                assert.equal(await page.evaluate(() => bubble.kind), type === 1 ? 'table' : 'image');
            });
        }
        for (const mode of ['locked', 'advanced', 'math']) {
            await check(`manual gesture retains ${mode} restrictions`, async page => {
                await page.evaluate(mode => {
                    query(); if (mode === 'advanced') DE.Views.CompactShell.advanced = true;
                    if (mode === 'locked') state.locked = true; if (mode === 'math') state.type = 5;
                    manual();
                }, mode); await open(page, false);
            });
        }
    } finally {await browser.close();}
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {console.error(error); process.exitCode = 1;});
