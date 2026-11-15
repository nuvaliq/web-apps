'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');

module.exports = async function openPlatformDocument({baseURL, credentialsFile, documentURL, extension, key}) {
    const credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
    const target = new URL('/v1/documents/'+encodeURIComponent(key)+'/open',baseURL);
    const body = JSON.stringify({document:{url:documentURL,title:'Presenter test.'+extension,filetype:extension},
        user:{id:'presenter-test',name:'Test'},grant:{mode:'edit'},editor:{lang:'ru',ui:{mode:'compact',shell:'modern'}}});
    const timestamp = String(Math.floor(Date.now()/1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const canonical = ['VO1','POST',target.pathname,target.search.slice(1),timestamp,nonce,crypto.createHash('sha256').update(body).digest('hex')].join('\n');
    const signature = 'v1='+crypto.createHmac('sha256',credentials.api_secret).update(canonical).digest('hex');
    const response = await fetch(target,{method:'POST',body,headers:{'content-type':'application/json',
        'X-VO-Key':credentials.key_id,'X-VO-Timestamp':timestamp,'X-VO-Nonce':nonce,'X-VO-Signature':signature}});
    if(!response.ok) throw new Error('Platform open HTTP '+response.status);
    return response.json();
};
