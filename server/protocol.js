// protocol.js (server side)
// -----------------------------------------------------------------------------
// The single source of truth for the WebSocket message "type" strings shared
// between the server and both browser windows. Keeping these as named constants
// avoids typos and makes the wire contract explicit.
//
// IMPORTANT: public/js/protocol.js must mirror these exact string values, since
// the browser cannot `require()` this CommonJS module directly.
// -----------------------------------------------------------------------------

const MSG = {
	// Server -> client: the full authoritative deck state.
	// Shape: { type: 'state', state: { currentIndex, slides: [{id, text}] } }
	STATE: 'state',

	// client -> server: move the presentation pointer.
	// Shape: { type: 'nav', action: 'next'|'prev'|'goto', index? }
	NAV: 'nav',

	// client -> server: edit one slide's text.
	// Shape: { type: 'editSlide', id, text }
	EDIT_SLIDE: 'editSlide',

	// client -> server: insert a blank slide after the given index (-1 = start).
	// Shape: { type: 'addSlide', afterIndex }
	ADD_SLIDE: 'addSlide',

	// client -> server: delete a slide by id.
	// Shape: { type: 'removeSlide', id }
	REMOVE_SLIDE: 'removeSlide',

	// client -> server: reorder all slides to match the given id order.
	// Shape: { type: 'reorder', orderedIds: [id, id, ...] }
	REORDER: 'reorder',

	// client -> server: toggle (or set) the presentation blackout.
	// Shape: { type: 'blackout', on?: boolean }
	// If `on` is omitted, the server flips the current value. When on, the
	// presentation window hides all content and shows a pure black screen.
	BLACKOUT: 'blackout',

	// client -> server: duplicate a slide by id, inserting the copy immediately
	// after the original. Does NOT change currentIndex (projector stays put).
	// Shape: { type: 'duplicateSlide', id }
	DUPLICATE_SLIDE: 'duplicateSlide',

	// client -> server: toggle (or set) the background image.
	// Shape: { type: 'background', on?: boolean }
	BACKGROUND: 'background',

	// client -> server: replace projector display settings (pads, fit, fade).
	// Shape: { type: 'displaySettings', settings: { ... } }
	// Server normalizes, keeps them in memory, and includes them on every
	// full-state broadcast so /present applies them live.
	DISPLAY_SETTINGS: 'displaySettings',

	// client -> server: the Presentation window's current inner size.
	// Shape: { type: 'viewport', width, height }
	// Control uses this so the preview stage matches the live projector
	// aspect ratio. Last present window to report wins.
	VIEWPORT: 'viewport',

	// Control -> server: ask every Presentation window to re-report its size.
	// Shape: { type: 'requestViewport' }
	// Used on Control page load so the preview does not sit on 16:9 waiting
	// for a resize. Server fans this out; Present answers with VIEWPORT.
	REQUEST_VIEWPORT: 'requestViewport',
};

module.exports = { MSG };
