// Spawns a *separate* server process on an unused port with its own data
// dir. Does not touch the operator's live `npm start` on :4000 and does not
// write data/deck.json. Asserts HTTP routes and one WebSocket state round-trip.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

const PORT = 18765;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-http-'));
const example = path.join(__dirname, '..', 'data', 'deck.example.json');

function get({ urlPath }) {
	return new Promise((resolve, reject) => {
		const req = http.get(`http://127.0.0.1:${PORT}${urlPath}`, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => {
				resolve({
					status: res.statusCode,
					body: Buffer.concat(chunks).toString('utf8'),
				});
			});
		});
		req.on('error', reject);
	});
}

function waitForStdout({ child, needle, timeoutMs }) {
	return new Promise((resolve, reject) => {
		let buf = '';
		const timer = setTimeout(() => {
			reject(new Error(`timed out waiting for ${JSON.stringify(needle)}; got: ${buf}`));
		}, timeoutMs);
		child.stdout.on('data', (chunk) => {
			buf += chunk.toString();
			if (buf.includes(needle)) {
				clearTimeout(timer);
				resolve(buf);
			}
		});
		child.stderr.on('data', (chunk) => {
			buf += chunk.toString();
		});
		child.on('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`server exited ${code} before ready. output:\n${buf}`));
		});
	});
}

describe('HTTP + WebSocket smoke (spawned server)', () => {
	let child;

	before(async () => {
		fs.copyFileSync(example, path.join(tmpDir, 'deck.json'));
		child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
			env: {
				...process.env,
				PORT: String(PORT),
				QUICKSLIDES_DATA_DIR: tmpDir,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const boot = await waitForStdout({
			child,
			needle: 'QuickSlides running',
			timeoutMs: 8000,
		});
		console.log('server boot output:\n', boot.trim());
	});

	after(() => {
		if (child && !child.killed) {
			child.kill('SIGTERM');
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('serves Control and Presentation HTML', async () => {
		const control = await get({ urlPath: '/' });
		const present = await get({ urlPath: '/present' });
		console.log('GET / status', control.status, 'len', control.body.length);
		console.log('GET /present status', present.status, 'len', present.body.length);
		assert.equal(control.status, 200);
		assert.equal(present.status, 200);
		assert.match(control.body, /control\.js/);
		assert.match(present.body, /present\.js/);
	});

	it('pushes full state on connect and after nav', async () => {
		const first = await new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
			const messages = [];
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error(`ws timeout, saw ${messages.length} messages`));
			}, 5000);
			ws.on('error', reject);
			ws.on('message', (data) => {
				const msg = JSON.parse(data.toString());
				messages.push(msg);
				if (messages.length === 1) {
					assert.equal(msg.type, 'state');
					assert.ok(Array.isArray(msg.state.slides));
					assert.ok(msg.state.displaySettings, 'state should include displaySettings');
					console.log(
						'connect state slides',
						msg.state.slides.length,
						'index',
						msg.state.currentIndex
					);
					console.log('connect displaySettings', msg.state.displaySettings);
					ws.send(JSON.stringify({ type: 'nav', action: 'next' }));
				} else if (messages.length === 2) {
					clearTimeout(timer);
					console.log('after nav index', msg.state.currentIndex);
					ws.close();
					resolve({ messages });
				}
			});
		});
		assert.equal(first.messages[0].state.currentIndex, 0);
		assert.equal(first.messages[1].state.currentIndex, 1);
		assert.equal(first.messages[1].type, 'state');
	});
});
