// protocol.js (browser side)
// -----------------------------------------------------------------------------
// MUST mirror server/protocol.js exactly. These are the WebSocket message type
// strings used by both control.js and present.js. Exposed as a global (window.MSG)
// because the pages load plain <script> files with no bundler.
// -----------------------------------------------------------------------------

window.MSG = {
	STATE: 'state', // server -> client: full deck state { currentIndex, slides }
	NAV: 'nav', // client -> server: { action: 'next'|'prev'|'goto', index? }
	EDIT_SLIDE: 'editSlide', // client -> server: { id, text }
	ADD_SLIDE: 'addSlide', // client -> server: { afterIndex }  (-1 = start)
	REMOVE_SLIDE: 'removeSlide', // client -> server: { id }
	REORDER: 'reorder', // client -> server: { orderedIds: [...] }
	BLACKOUT: 'blackout', // client -> server: { on?: boolean }  (omit on to toggle)
	DUPLICATE_SLIDE: 'duplicateSlide', // client -> server: { id }
	BACKGROUND: 'background', // client -> server: { on?: boolean }
};
