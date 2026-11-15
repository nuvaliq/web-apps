'use strict';
// Run with PRESENTER_DS_URL, PRESENTER_OPEN_KEY_FILE and PLAYWRIGHT_MODULE.
// The server must use separate opening/session keys; the test hosts its own fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {execFileSync} = require('node:child_process');
const browserClass='presenter-test-'+process.pid;
const headless=process.env.PRESENTER_HEADLESS!=='0';
const nativeKeys=process.env.PRESENTER_NATIVE_KEYS==='1'&&!headless;
const ds = process.env.PRESENTER_DS_URL;
assert.ok(ds, 'PRESENTER_DS_URL is required');
const secret = fs.readFileSync(process.env.PRESENTER_OPEN_KEY_FILE, 'utf8').trim();
const documentType = process.env.PRESENTER_DOCUMENT_TYPE || 'slide';
const extension = {slide:'pptx',word:'docx',cell:'xlsx'}[documentType];
const fixture = fs.readFileSync(process.env.PRESENTER_FIXTURE_FILE || path.join(__dirname, 'two-slides.pptx'));
const entry = process.env.PRESENTER_ENTRY || 'arrow';
const scenario = process.env.PRESENTER_CASE || 'presenter';
const output = process.env.PRESENTER_OUTPUT_DIR;
const platformURL=process.env.PRESENTER_PLATFORM_URL;
const isGateway=!!(platformURL || process.env.PRESENTER_GATEWAY_HOST_URL);
const failures = [];
const authenticationFrames = [];
const networkErrors = [];
const pageErrors = [];
const handshakes = [];
const startupTimes = [];
const devAssets={loader:false,sdkList:false};
let browser, server, config, activePage;
function sign(value) {
    const prefix = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(value)).toString('base64url');
    return prefix + '.' + crypto.createHmac('sha256', secret).update(prefix).digest('base64url');
}
function observeHandshake(payload,reporter) {
    if(typeof payload !== 'string' || !payload.startsWith('40{')) return;
    const auth=JSON.parse(payload.slice(2));
    handshakes.push({reporter,session:!!auth.session,token:!!auth.token,
        dataSession:!!auth.data?.jwtSession,dataOpen:!!auth.data?.jwtOpen,mode:auth.data?.mode});
}
async function state(frame) {
    return frame.evaluate(() => {
        const api = window.editor, manager = api && api.WordControl && api.WordControl.DemonstrationManager;
        return {mode: !!(manager && manager.Mode), slide: manager && manager.SlideNum,
            count: api && api.WordControl && api.WordControl.m_oLogicDocument && api.WordControl.m_oLogicDocument.Slides.length,
            waiting: !!document.getElementById('dem_id_wait_reporter'), timer: document.getElementById('dem_id_time')?.textContent,
            popup: !!(api && api.reporterWindow && !api.reporterWindow.closed)};
    });
}
async function until(frame, predicate, timeout = 30000) {await frame.waitForFunction(predicate, null, {timeout});}
async function choose(frame, presenter = true) {
    if (entry === 'view') {
        await frame.locator('.vo-mn-item').filter({hasText:/^Вид$/}).click();
        await frame.locator('.vo-mn-drop.open .vo-mn-sub').filter({hasText:/^Начать показ слайдов$/}).click();
        await frame.locator('.vo-mn-fly.open .vo-mn-sub').filter({hasText: presenter ? 'Показ слайдов в режиме докладчика' : /^Показ слайдов с начала$/}).click();
    } else {
        await frame.locator('.vo-show-arrow').click();
        await frame.locator('.vo-show-pop [role="menuitem"]').filter({hasText: presenter ? 'Показ слайдов в режиме докладчика' : /^Показ слайдов с начала$/}).click();
    }
}
async function start(page, frame) {
    const originalToken=await frame.evaluate(() => editor.asc_getReporterAuth().token);
    const startedAt=Date.now();
    let popupError;
    const popupPromise = page.waitForEvent('popup').catch(error=>{popupError=error;return null;});
    await choose(frame); const popup = await popupPromise;
    if(!popup) throw popupError;
    popup.presenterStartedAt=startedAt;
    popup.presenterInitialToken=originalToken;
    await popup.waitForLoadState('domcontentloaded'); await popup.bringToFront();
    if (isGateway) {
        const relation = await popup.evaluate(() => ({origin:location.origin,openerIsFrame:window.opener !== window.opener.top}));
        assert.equal(relation.origin,new URL(frame.url()).origin);
        assert.notEqual(relation.origin,new URL(page.url()).origin);
        assert.equal(relation.openerIsFrame,true);
        assert.ok(new URL(frame.url()).pathname.startsWith('/s/'));
    }
    console.log('presenter opened'); return popup;
}
async function verifyShow(frame, popup) {
    await until(frame, () => window.editor?.WordControl?.DemonstrationManager?.Mode === true);
    await until(popup, () => window.editor?.WordControl?.DemonstrationManager?.Mode === true);
    await popup.bringToFront();
    await until(popup, () => document.hasFocus());
    const startupMs=Date.now()-popup.presenterStartedAt;
    startupTimes.push(startupMs); assert.ok(startupMs<=30000,'both presenter windows ready within 30 seconds');
    console.log('show ready');
    const before = await state(popup); assert.equal(before.count,2); assert.equal((await state(frame)).count,2);
    assert.equal((await state(frame)).waiting,false); assert.equal(before.slide,0);
    await until(popup, () => document.getElementById('dem_id_time')?.textContent !== '00:00:00');
    const timer = (await state(popup)).timer;
    await popup.waitForTimeout(1200); assert.notEqual((await state(popup)).timer,timer,'presenter timer advances');
    console.log('timer advances');
    await popup.locator('#dem_id_next').click();
    await until(frame, () => editor.WordControl.DemonstrationManager.SlideNum === 1);
    await until(popup, () => editor.WordControl.DemonstrationManager.SlideNum === 1);
    await popup.waitForTimeout(250);
    assert.equal((await state(frame)).slide,1); assert.equal((await state(popup)).slide,1);
    console.log('next slide synchronized');
    await popup.locator('#dem_id_prev').click();
    await until(frame, () => editor.WordControl.DemonstrationManager.SlideNum === 0);
    await until(popup, () => editor.WordControl.DemonstrationManager.SlideNum === 0);
    await popup.waitForTimeout(250);
    assert.equal((await state(frame)).slide,0); assert.equal((await state(popup)).slide,0);
    console.log('previous slide synchronized');
    await popup.locator('#dem_id_play').click();
    await until(frame, () => editor.WordControl.DemonstrationManager.IsPlayMode === false);
    const paused = (await state(popup)).timer; await popup.waitForTimeout(1200); assert.equal((await state(popup)).timer,paused);
    await popup.locator('#dem_id_play').click();
    await until(frame, () => editor.WordControl.DemonstrationManager.IsPlayMode === true);
    console.log('pause and play synchronized');
    await popup.locator('#dem_id_pointer').click();
    const box = await popup.evaluate(() => {
        const r = editor.WordControl.DemonstrationManager.DemonstrationDiv.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
    });
    await popup.mouse.move(box.x,box.y);
    await until(frame, () => !!editor.WordControl.DemonstrationManager.PointerDiv);
    await popup.locator('#dem_id_pointer').click();
    await until(frame, () => !editor.WordControl.DemonstrationManager.PointerDiv);

}
async function verifyAuthSnapshot(popup) {
    const snapshot = await popup.evaluate(() => {
        const connection = (window.editor || window.Asc.editor).CoAuthoringApi._CoAuthoringApi, auth = connection.socketio.auth;
        return {session: !!connection.jwtSession, outer: auth.session === connection.jwtSession,
            inner: auth.data.jwtSession === connection.jwtSession, openCleared: !auth.token && !auth.data.jwtOpen};
    });
    assert.deepEqual(snapshot,{session:true,outer:true,inner:true,openCleared:true});
}
async function reconnect(popup,closeTransport) {
    const before = await popup.evaluate(() => editor.CoAuthoringApi._CoAuthoringApi.jwtSession);
    assert.ok(before && before!==popup.presenterInitialToken,'server refreshed the supplied token before reconnect');
    await popup.waitForTimeout(1500);
    const previousHandshakes=handshakes.length;
    console.log('interrupting presenter transport');
    await closeTransport();
    console.log('presenter transport interrupted');
    await popup.waitForFunction(old => {
        const connection = editor.CoAuthoringApi._CoAuthoringApi;
        return connection.socketio.connected && connection.jwtSession === old;
    },before,{timeout:30000}).catch(async error => {
        const observed=await popup.evaluate(old=>{const c=editor.CoAuthoringApi._CoAuthoringApi;return {connected:!!c.socketio.connected,sessionChanged:c.jwtSession!==old};},before);
        console.log(JSON.stringify({reconnect:observed,newHandshakes:handshakes.length-previousHandshakes}));throw error;
    });
    for(let attempt=0;attempt<60&&handshakes.length===previousHandshakes;attempt++) await popup.waitForTimeout(500);
    assert.ok(handshakes.length>previousHandshakes,'real reconnect sent another authentication handshake');
    await verifyAuthSnapshot(popup);
}
async function finish(frame, popup) {
    const closed = popup.waitForEvent('close'); await popup.locator('#dem_id_end').click(); await closed;
    await until(frame, () => !editor.WordControl.DemonstrationManager.Mode && !editor.reporterWindow);
    assert.equal((await state(frame)).waiting,false);
}
async function main() {
    if (output) fs.mkdirSync(output,{recursive:true});
    server = http.createServer((req,res) => {
        if(req.url === '/fixture.'+extension) {res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.presentationml.presentation'});res.end(fixture);return;}
        if(req.url === '/callback') {res.writeHead(200,{'content-type':'application/json'});res.end('{"error":0}');return;}
        res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
        if(platformURL) {
            res.end('<!doctype html><html><head><style>html,body,#editor{margin:0;height:100%}</style></head><body><div id="editor"></div><script>function define(deps,factory){const helper={};factory(helper);helper.createEditor({element:"editor",openConfig:'+JSON.stringify(config)+'});}define.amd={};</script><script src="http://127.0.0.1:18295/vendor/helper.umd.cjs"></script></body></html>');return;
        }
        res.end('<!doctype html><html><head><style>html,body,#editor{margin:0;height:100%}</style></head><body><div id="editor"></div><script src="'+ds+'/web-apps/apps/api/documents/api.js"></script><script>new DocsAPI.DocEditor("editor",'+JSON.stringify(config)+');</script></body></html>');
    });
    await new Promise(resolve => server.listen(0,'0.0.0.0',resolve));
    const port = server.address().port;
    const fixtureHost = process.env.PRESENTER_FIXTURE_HOST || 'host.docker.internal';
    config = {document:{fileType:extension, key:'presenter-'+crypto.randomBytes(10).toString('hex'),title:'Presenter test.'+extension,url:'http://'+fixtureHost+':'+port+'/fixture.'+extension,permissions:{edit:true,download:true,print:true}},
        documentType,editorConfig:{mode:'edit',lang:'ru',callbackUrl:'http://'+fixtureHost+':'+port+'/callback',user:{id:'presenter-test',name:'Test'},customization:{chat:false,comments:false,help:false,forcesave:false},ui:{shell:'modern'}},type:'desktop',width:'100%',height:'100%'};
    config.token = sign(config);
    if(platformURL) config=await require('./platform-fixture.cjs')({baseURL:platformURL,credentialsFile:process.env.PRESENTER_PLATFORM_CREDENTIALS_FILE,
        documentURL:'http://'+fixtureHost+':'+port+'/fixture.'+extension,extension,key:config.document.key});
    browser = await chromium.launch({channel:'chrome',headless,args:['--no-first-run','--disable-dev-shm-usage','--class='+browserClass]});
    const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'});
    context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
    context.on('page', p => {p.on('pageerror',e=>pageErrors.push(e.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token]'))); p.on('response', r => {if(r.status()>=400&&/(?:sdkjs|web-apps)/.test(r.url())) networkErrors.push({status:r.status(),file:new URL(r.url()).pathname.split('/').slice(-4).join('/')});if(r.status() === 404 && /reporter-ready/.test(r.url())) failures.push('readiness module 404'); if(r.ok()&&/app_dev\.reporter\.js/.test(r.url())) devAssets.loader=true; if(r.ok()&&/develop\/sdkjs\/slide\/scripts\.js/.test(r.url())) devAssets.sdkList=true;});
        p.on('websocket', ws => {
            ws.on('framereceived', ({payload}) => {if(typeof payload === 'string' && /"code"\s*:\s*4006\b|token:invalid signature/.test(payload)) {
                failures.push('authentication refused');
                const redacted=payload.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token]');
                const index=redacted.search(/"code"\s*:\s*4006\b|token:invalid signature/);
                authenticationFrames.push({reporter:/index\.reporter/.test(p.url()),matchInsideToken:index<0,context:index<0?'[token]':redacted.slice(Math.max(0,index-60),index+100)});
            }});
            ws.on('framesent', ({payload}) => {
                observeHandshake(payload,/index\.reporter/.test(p.url()));
            });
        });});
    const page = activePage = await context.newPage(); console.log('browser launched');
    if (process.env.PRESENTER_GATEWAY_HOST_URL && !platformURL) {
        await page.goto(process.env.PRESENTER_GATEWAY_HOST_URL, {waitUntil:'domcontentloaded',timeout:30000});
        await page.locator('#compact-upload').check();
        await page.locator('#file-input').setInputFiles(path.join(__dirname,'two-slides.pptx'));
        await page.getByRole('button',{name:'Загрузить и открыть'}).click();
    } else await page.goto('http://127.0.0.1:'+port, {waitUntil:'domcontentloaded',timeout:30000});
    console.log('host loaded');
    await page.waitForFunction(() => !!document.querySelector('iframe'));
    let frame;
    for (let attempt=0;attempt<180;attempt++) {
        frame = page.frames().find(f => /(?:presentationeditor|documenteditor|spreadsheeteditor)\/main\/index/.test(f.url()));
        if (frame) break;
        await page.waitForTimeout(500);
    }
    assert.ok(frame,'editor iframe exists');
    if (scenario === 'compatibility') await until(frame, () => (window.editor || window.Asc?.editor)?.isDocumentLoadComplete,90000);
    else await until(frame, () => window.editor?.WordControl?.m_oLogicDocument?.Slides.length === 2,90000);
    console.log('editor ready');
    let closeTransport;
    if(scenario === 'reconnect' || scenario === 'auth-open') await context.routeWebSocket(/\/doc\//, ws => {
        const remote = ws.connectToServer();
        ws.onMessage(message => {observeHandshake(message,true);remote.send(message);});
        closeTransport = () => ws.close({code:1011,reason:'Network interruption test'});
    });
    if (scenario === 'compatibility') {
        await verifyAuthSnapshot(frame);
        assert.equal(await frame.evaluate(() => (window.editor || window.Asc.editor).DocInfo.get_TokenType()),'open');
        const first = handshakes.find(row => !row.reporter); assert.ok(first?.token && first.dataOpen && !first.session && !first.dataSession);
    } else if (scenario === 'auth-open' || scenario === 'auth-bad') {
        const data = await frame.evaluate(() => ({...PE.getController('Main').document}));
        data.tokenType = 'open'; data.token = config.token;
        data.translations = {reset:'Reset',endSlideshow:'End slideshow',slideOf:'Slide',finalMessage:'End',pen:'Pen',highlighter:'Highlighter',inkColor:'Color',eraser:'Eraser',eraseScreen:'Erase',play:'Play',pause:'Pause',prevSlide:'Previous',nextSlide:'Next',pointer:'Pointer',draw:'Draw'};
        if (scenario === 'auth-bad') {
            const index = data.token.lastIndexOf('.')+1;
            data.token = data.token.slice(0,index)+(data.token[index] === 'a' ? 'b' : 'a')+data.token.slice(index+1);
        }
        const url = ds+'/presenter-test-parent.html';
        await context.route(url, route => route.fulfill({contentType:'text/html',body:'<!doctype html><button id="start">Start</button><script>let sent=false;document.getElementById("start").onclick=()=>window.popup=window.open("/web-apps/apps/presentationeditor/main/index.reporter.html?reporterEndLabel=End%20slideshow");window.addEventListener("message",e=>{if(e.source===window.popup&&e.origin===location.origin&&e.data==="i:am:ready"&&!sent){sent=true;popup.postMessage(JSON.stringify({type:"file:open",data:'+JSON.stringify(data)+'}),location.origin);}else if(e.source===window.popup&&e.origin===location.origin){try{if(JSON.parse(e.data).reporter_command==="end")popup.close();}catch{}}});</script>'}));
        const parent = await context.newPage(); await parent.goto(url);
        const promised = parent.waitForEvent('popup'); await parent.locator('#start').click(); const popup = await promised;
        popup.presenterInitialToken=data.token;
        await popup.bringToFront();
        if (scenario === 'auth-bad') {
            for(let i=0;i<60&&!failures.includes('authentication refused');i++) await popup.waitForTimeout(500);
            assert.ok(failures.includes('authentication refused'),'invalid signature is refused');
            const closed = popup.waitForEvent('close'); await popup.locator('#reporter_loading_end').click(); await closed;
            failures.length=0;
        } else {
            await until(popup, () => window.editor?.WordControl?.DemonstrationManager?.Mode === true);
            assert.equal((await state(popup)).count,2);
            await until(popup, () => document.getElementById('dem_id_time')?.textContent !== '00:00:00');
            await verifyAuthSnapshot(popup);
            await reconnect(popup,closeTransport);
            const auth = handshakes.find(row => row.reporter);
            assert.deepEqual(auth,{reporter:true,session:false,token:true,dataSession:false,dataOpen:true,mode:'view'});
            const closed = popup.waitForEvent('close'); await popup.locator('#dem_id_end').click(); await closed;
        }
    } else if (scenario === 'ordinary') {
        await choose(frame,false); await until(frame, () => editor.WordControl.DemonstrationManager.Mode === true);
        assert.equal((await state(frame)).slide,0); assert.equal(context.pages().length,1);
        await page.keyboard.press('ArrowRight'); await until(frame, () => editor.WordControl.DemonstrationManager.SlideNum === 1);
        await until(frame, () => !!document.fullscreenElement);
        if(nativeKeys) execFileSync('python3',[path.join(__dirname,'native-escape.py'),browserClass]);
        else await page.keyboard.press('Escape');
        await until(frame, () => !document.fullscreenElement);
        if(nativeKeys) assert.equal((await state(frame)).mode,true,'first Escape only leaves browser fullscreen');
        if(nativeKeys) execFileSync('python3',[path.join(__dirname,'native-escape.py'),browserClass]);
        else await page.keyboard.press('Escape');
        await until(frame, () => !editor.WordControl.DemonstrationManager.Mode);
    } else if (scenario === 'cancel' || scenario === 'cancel-auth' || scenario === 'close') {
        await context.route(/\/app(?:_dev)?\.reporter\.js(?:\?|$)/, async route => {await new Promise(resolve => setTimeout(resolve,2000)); await route.continue().catch(()=>{});});
        if(scenario === 'cancel-auth') await context.routeWebSocket(/\/doc\//, ws => {
            const remote = ws.connectToServer();
            remote.onMessage(message => setTimeout(() => {try {ws.send(message);} catch {}},4000));
        });
        const popup = await start(page,frame);
        if(scenario === 'close') await popup.close({runBeforeUnload:process.env.PRESENTER_SKIP_BEFORE_UNLOAD!=='1'});
        else {
            const button = popup.locator('#reporter_loading_end'); await button.waitFor({state:'visible'});
            assert.equal(await button.textContent(),'Завершить показ слайдов');
            if(scenario === 'cancel') assert.equal(await popup.evaluate(() => !editor.DocInfo),true,'cancel before metadata');
            else await until(popup, () => !!editor.DocInfo && !editor.isDocumentLoadComplete);
            const closed = popup.waitForEvent('close'); await button.click(); await closed;
        }
        await until(frame, () => !editor.reporterWindow && !document.getElementById('dem_id_wait_reporter'));
    } else {
        const count = scenario === 'lifecycle' ? 3 : 1;
        for (let i=0;i<count;i++) {const popup = await start(page,frame); await verifyShow(frame,popup);
            await verifyAuthSnapshot(popup);
            if(scenario === 'reconnect') await reconnect(popup,closeTransport);
            if(output) {await popup.screenshot({path:path.join(output,'reporter-'+i+'.png')});await page.screenshot({path:path.join(output,'main-'+i+'.png')});}
            await finish(frame,popup);}
    }
    assert.deepEqual(failures,[]);
    if(process.env.PRESENTER_EXPECT_DEV==='1') assert.deepEqual(devAssets,{loader:true,sdkList:true});
    if(process.env.PRESENTER_EXPECT_DEV==='bootstrap') assert.equal(devAssets.sdkList,true);
    if (scenario === 'presenter' || scenario === 'lifecycle' || scenario === 'reconnect') {
        const first = handshakes.find(auth => auth.reporter);
        assert.ok(first, 'presenter sent a real authentication handshake');
        assert.deepEqual(first, {reporter:true,session:true,token:false,dataSession:true,dataOpen:false,mode:'view'});
    }
    const result = {status:'PASS',scenario,documentType,entry,browser:browser.version(),headless,sdkMethodsReplaced:false,controlledNetwork:['reconnect','auth-open','cancel','cancel-auth','close'].includes(scenario),startupTimes,handshakes,devAssets,nativeBrowserKeys:nativeKeys};
    if(output) fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
}
main().catch(async e => {
    const message = e.name+': '+e.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token]');
    console.error(message); process.exitCode=1;
    if(output && activePage && !activePage.isClosed()) {
        await activePage.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
        const frames = [];
        for(const frame of activePage.frames()) if(/editor\/main\/index/.test(frame.url())) frames.push(await state(frame).catch(()=>({unavailable:true})));
        const popups=[];
        for(const page of activePage.context().pages()) if(page !== activePage && !page.isClosed()) {
            await page.screenshot({path:path.join(output,'failure-popup-'+popups.length+'.png')}).catch(()=>{});
            popups.push(await state(page).catch(()=>({unavailable:true})));
        }
        fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({status:'FAIL',scenario,message,frames,popups,handshakes,authenticationFrames,networkErrors,pageErrors},null,2));
    }
})
.finally(async()=>{if(browser) await browser.close();if(server) await new Promise(resolve=>server.close(resolve));});
