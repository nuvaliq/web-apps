const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('apps/api/documents/api.js');
const start = source.indexOf('    MessageDispatcher = function(');
const end = source.indexOf('\n    function getShardkey', start);
assert.ok(start >= 0 && end > start);

const origin = 'https://editor.example';
const frame = {};
const foreign = {};
let receive;
const context = {
    window: {
        JSON,
        addEventListener: (name, handler) => { if (name === 'message') receive = handler; }
    }
};
vm.runInNewContext(source.slice(start, end), context);
const received = [];
context.MessageDispatcher((message, verified) => {
    received.push({message, verified});
}, {frameOrigin: origin}, () => frame);

const send = (sender, event, data, senderOrigin = origin) => receive({
    origin: senderOrigin,
    source: sender,
    data: JSON.stringify({event, data, sourceVerified: true})
});

send(foreign, 'onInfo', {mode: 'view', b24TransportState: 'reconnecting', b24EditingAvailable: true});
assert.deepEqual(received[0].message.data, {mode: 'view', b24EditingAvailable: true});
assert.notEqual(received[0].verified, true);

send(frame, 'onInfo', {mode: 'edit', b24TransportState: 'reconnecting'});
assert.equal(received[1].message.data.b24TransportState, 'reconnecting');
assert.equal(received[1].message.data.mode, 'edit');
assert.equal(received[1].verified, true);

send(foreign, 'onDocumentStateChange', false);
assert.notEqual(received[2].verified, true);
assert.equal(received[2].message.data, false);

send(frame, 'onDocumentReady', {});
assert.equal(received[3].verified, true);
send(frame, 'onDocumentReady', {}, 'https://other.example');
assert.equal(received.length, 4);

function createGateway(frameEditorId) {
    const messages = [];
    const common = {};
    vm.runInNewContext(read('apps/common/Gateway.js'), {
        Common: common,
        $: () => ({}),
        window: {
            Common: common,
            JSON,
            frameEditorId,
            parent: { postMessage: payload => messages.push(JSON.parse(payload)) },
            addEventListener: () => {}
        }
    });
    return { gateway: common.Gateway, messages };
}

const first = createGateway('first');
const second = createGateway('second');
first.gateway.reportTransportConnected();
first.gateway.reportTransportReconnecting();
first.gateway.reportTransportReconnecting();
second.gateway.reportTransportReconnecting();
first.gateway.reportTransportConnected();
first.gateway.reportTransportConnected();
first.gateway.reportTransportReconnecting();
assert.deepEqual(first.messages.map(message => [message.event, message.frameEditorId, message.data.b24TransportState]), [
    ['onInfo', 'first', 'reconnecting'],
    ['onInfo', 'first', 'connected'],
    ['onInfo', 'first', 'reconnecting'],
]);
assert.deepEqual(second.messages.map(message => [message.event, message.frameEditorId, message.data.b24TransportState]), [
    ['onInfo', 'second', 'reconnecting'],
]);
console.log('Editor transport events are verified against the current iframe');
