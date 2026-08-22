// The browser cannot require() server/protocol.js, so public/js/protocol.js
// is a hand-maintained mirror. This test fails the build if someone updates
// one file and forgets the other — that bug would look like "buttons do
// nothing" because the server ignores unknown message types.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MSG: serverMsg } = require('../server/protocol');

function loadBrowserMsg() {
	const filePath = path.join(__dirname, '..', 'public', 'js', 'protocol.js');
	const source = fs.readFileSync(filePath, 'utf8');
	const sandbox = { window: {} };
	vm.runInNewContext(source, sandbox, { filename: filePath });
	return sandbox.window.MSG;
}

describe('WebSocket protocol constants', () => {
	it('browser window.MSG matches server MSG key-for-key and value-for-value', () => {
		const browserMsg = loadBrowserMsg();
		const serverKeys = Object.keys(serverMsg).sort();
		const browserKeys = Object.keys(browserMsg).sort();
		console.log('server MSG keys:', serverKeys);
		console.log('browser MSG keys:', browserKeys);
		console.log('server MSG:', serverMsg);
		console.log('browser MSG:', browserMsg);
		assert.deepEqual(browserKeys, serverKeys);
		// JSON round-trip: browser MSG is created inside vm.runInNewContext, so
		// it lives in another realm. deepStrictEqual then fails with "same
		// structure but not reference-equal" even when every key/value matches.
		const browserPlain = JSON.parse(JSON.stringify(browserMsg));
		const serverPlain = JSON.parse(JSON.stringify(serverMsg));
		assert.deepEqual(browserPlain, serverPlain);
	});
});
