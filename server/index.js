// index.js
// -----------------------------------------------------------------------------
// The single application server. Responsibilities:
//   1. Serve the static frontend (control + presentation pages) from /public.
//   2. Run a WebSocket server on the SAME http server/port so both browser
//      windows can connect and receive live state pushes.
//   3. Translate incoming client messages into state mutations, then broadcast
//      the new full state to every connected client (control AND presentation).
//
// Why full-state broadcast instead of diffs? The deck is small and this makes
// every window trivially consistent: whoever changes anything, everyone sees
// the exact same authoritative state immediately. No diff/merge bugs.
//
// Transport choice: WebSockets (via the `ws` library). Bidirectional, low
// latency, dead simple for this "one editor drives many viewers" use case.
// -----------------------------------------------------------------------------

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const state = require('./state');
const { MSG } = require('./protocol');

// Port is configurable via env for flexibility; defaults to 4000.
const PORT = process.env.PORT || 4000;

// Hydrate the deck from disk before we accept any connections.
state.loadDeck();

const app = express();

// Serve everything in /public as static assets. control.html is the index.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Explicit routes so the URLs read nicely:
//   /          -> the control (editor) window
//   /present   -> the presentation (viewer) window
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'control.html')));
app.get('/present', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'present.html')));

// Upload a new background image (jpeg/png/webp). Saved under public/bg/custom.*
// and the deck's backgroundUrl is updated + broadcast so both windows pick it up.
app.post(
	'/api/background',
	express.raw({
		type: (req) => String(req.headers['content-type'] || '').startsWith('image/'),
		limit: '8mb',
	}),
	(req, res) => {
		const ct = String(req.headers['content-type'] || '');
		const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
		const dest = path.join(PUBLIC_DIR, 'bg', 'custom' + ext);
		try {
			fs.writeFileSync(dest, req.body);
		} catch (err) {
			res.status(500).json({ ok: false, error: err.message });
			return;
		}
		const url = `/bg/custom${ext}?t=${Date.now()}`;
		state.setBackground({ on: true, url });
		broadcastState();
		res.json({ ok: true, url });
	}
);

// Create a raw http server so Express and the WebSocket server can share a port.
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast the current authoritative deck state to every open socket. This is
// called after any mutation and once to each client on connect.
function broadcastState() {
	const payload = JSON.stringify({ type: MSG.STATE, state: state.getDeck() });
	for (const client of wss.clients) {
		// readyState 1 === OPEN. Skip clients that are connecting/closing.
		if (client.readyState === 1) client.send(payload);
	}
}

// Handle a single decoded client message by dispatching to the right mutation,
// then broadcasting the result. Unknown types are ignored (forward-compatible).
function handleMessage(msg) {
	switch (msg.type) {
		case MSG.NAV:
			state.navigate({ action: msg.action, index: msg.index });
			break;
		case MSG.EDIT_SLIDE:
			state.editSlide({ id: msg.id, text: msg.text });
			break;
		case MSG.ADD_SLIDE:
			state.addSlide({ afterIndex: msg.afterIndex });
			break;
		case MSG.DUPLICATE_SLIDE:
			state.duplicateSlide({ id: msg.id });
			break;
		case MSG.REMOVE_SLIDE:
			state.removeSlide({ id: msg.id });
			break;
		case MSG.REORDER:
			state.reorder({ orderedIds: msg.orderedIds });
			break;
		case MSG.BLACKOUT:
			state.setBlackout({ on: msg.on });
			break;
		case MSG.BACKGROUND:
			state.setBackground({ on: msg.on });
			break;
		default:
			// Unknown message types are silently ignored on purpose.
			return false;
	}
	return true;
}

wss.on('connection', (ws) => {
	// Immediately send the newcomer the full current state so it can render.
	ws.send(JSON.stringify({ type: MSG.STATE, state: state.getDeck() }));

	ws.on('message', (data) => {
		let msg;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return; // ignore malformed frames
		}
		const changed = handleMessage(msg);
		if (changed) broadcastState();
	});
});

server.listen(PORT, () => {
	console.log(`\n  QuickSlides running:`);
	console.log(`    Control (edit):     http://localhost:${PORT}/`);
	console.log(`    Presentation (view): http://localhost:${PORT}/present\n`);
});
