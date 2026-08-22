// ws-client.js
// -----------------------------------------------------------------------------
// A tiny shared WebSocket helper used by BOTH the control and presentation
// pages. It handles:
//   - opening the socket to the same host/port that served the page
//   - auto-reconnect with a short backoff if the connection drops
//   - decoding incoming JSON and delivering 'state' payloads to a callback
//   - a send() that JSON-encodes outgoing messages
//
// Usage:
//   const sock = SlideSocket.connect({
//     onState: (state) => { ...render... },
//     onStatus: (isConnected) => { ...optional UI...},
//   });
//   sock.send({ type: MSG.NAV, action: 'next' });
// -----------------------------------------------------------------------------

window.SlideSocket = (function () {
	function connect({ onState, onStatus, onOpen, onMessage }) {
		// Derive the ws:// (or wss:// under https) URL from the current page origin
		// so this works whether served on localhost, LAN IP, or a tunnel.
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${window.location.host}`;

		let ws = null;
		let reconnectTimer = null;

		// Latest state is cached so newly-attached UI can read it synchronously.
		const api = {
			lastState: null,
			send(msg) {
				if (ws && ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify(msg));
				}
			},
		};

		function open() {
			ws = new WebSocket(url);

			ws.onopen = () => {
				if (typeof onStatus === 'function') onStatus(true);
				// Control uses this to re-push localStorage display settings after
				// every reconnect so a server restart does not drop them.
				if (typeof onOpen === 'function') onOpen();
			};

			ws.onmessage = (event) => {
				let msg;
				try {
					msg = JSON.parse(event.data);
				} catch {
					return; // ignore malformed frames
				}
				// We currently only care about full-state pushes from the server.
				if (msg.type === window.MSG.STATE && typeof onState === 'function') {
					api.lastState = msg.state;
					onState(msg.state);
				}
				// Non-state frames (e.g. requestViewport) — Presentation uses
				// this to re-send innerWidth/innerHeight on demand.
				if (typeof onMessage === 'function') onMessage(msg);
			};

			ws.onclose = () => {
				if (typeof onStatus === 'function') onStatus(false);
				// Try to reconnect shortly; the server may have restarted.
				if (reconnectTimer) clearTimeout(reconnectTimer);
				reconnectTimer = setTimeout(open, 1000);
			};

			ws.onerror = () => {
				// Force a close so onclose's reconnect logic kicks in.
				try {
					ws.close();
				} catch {
					/* no-op */
				}
			};
		}

		open();
		return api;
	}

	return { connect };
})();
