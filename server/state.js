// state.js
// -----------------------------------------------------------------------------
// Owns the in-memory deck state and its persistence to disk (data/deck.json).
//
// The "deck" is the whole presentation. It has:
//   - slides:       an ordered array of slide objects { id, text }
//   - currentIndex: which slide the PRESENTATION window is currently showing
//   - blackout:     when true, the presentation hides ALL content (pure black)
//   - backgroundOn: when true, the presentation shows the background image
//   - backgroundUrl: path to the current background image (served from /bg/)
//
// We keep the model deliberately simple: each slide's body is a single string
// with embedded newlines. The control window edits that string in a <textarea>;
// the presentation window renders each line separately. This keeps live editing
// trivial (one field) while still supporting multi-line lyrics.
//
// Persistence strategy: after every mutation we write the whole file. The deck
// is small (a few hundred slides of short text), so whole-file writes are cheap
// and eliminate any chance of partial/corrupt incremental state. Writes are
// debounced so a burst of keystrokes doesn't hammer the disk.
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Absolute path to the on-disk JSON file that is the source of truth between
// server restarts. Lives in the project's data/ directory, unless a test (or
// a weird install) points QUICKSLIDES_DATA_DIR somewhere else. Tests MUST set
// that env var *before* requiring this module, or they would overwrite the
// operator's real deck.json.
const DATA_DIR = process.env.QUICKSLIDES_DATA_DIR
	? path.resolve(process.env.QUICKSLIDES_DATA_DIR)
	: path.join(__dirname, '..', 'data');
const DECK_FILE = path.join(DATA_DIR, 'deck.json');
// Shipped sample deck (original placeholder lyrics, safe to publish). Copied
// to DECK_FILE on first load so a fresh clone has something to project.
const EXAMPLE_FILE = path.join(__dirname, '..', 'data', 'deck.example.json');

// The live, in-memory deck. Everything reads/writes this object. On startup we
// hydrate it from disk (if present); otherwise we start with an empty deck.
const DEFAULT_BG_URL = '/bg/default.jpg';

let deck = {
	currentIndex: 0,
	slides: [],
	blackout: false,
	backgroundOn: false,
	backgroundUrl: DEFAULT_BG_URL,
};

function applyBackgroundFields({ parsed }) {
	return {
		backgroundOn: parsed && parsed.backgroundOn === true,
		backgroundUrl:
			parsed && typeof parsed.backgroundUrl === 'string' && parsed.backgroundUrl
				? parsed.backgroundUrl
				: DEFAULT_BG_URL,
	};
}

// Handle for the debounced disk-write timer so we can coalesce rapid changes.
let saveTimer = null;

// Generate a stable unique id for a slide. Using randomUUID means ids survive
// reordering/editing and can be referenced by the client without index math.
function newId() {
	return crypto.randomUUID();
}

// Make sure the data directory exists before we ever try to write to it.
function ensureDataDir() {
	if (!fs.existsSync(DATA_DIR)) {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	}
}

// If the operator has never saved a deck, seed from the example so a clone
// of the public repo is immediately usable. Never overwrite an existing file.
function seedFromExampleIfNeeded() {
	if (fs.existsSync(DECK_FILE)) return;
	if (!fs.existsSync(EXAMPLE_FILE)) return;
	ensureDataDir();
	fs.copyFileSync(EXAMPLE_FILE, DECK_FILE);
}

// Load the deck from disk into memory. Called once at startup. If the file is
// missing or unreadable we fall back to an empty deck rather than crashing, so
// a fresh checkout "just works" before any import has happened.
function loadDeck() {
	try {
		seedFromExampleIfNeeded();
		if (fs.existsSync(DECK_FILE)) {
			const raw = fs.readFileSync(DECK_FILE, 'utf8');
			const parsed = JSON.parse(raw);
			// Defensive normalization: guarantee the shape we depend on.
			deck = {
				currentIndex: Number.isInteger(parsed.currentIndex) ? parsed.currentIndex : 0,
				slides: Array.isArray(parsed.slides) ? parsed.slides : [],
				blackout: parsed.blackout === true,
				...applyBackgroundFields({ parsed }),
			};
			clampIndex();
		}
	} catch (err) {
		// Bad JSON on disk shouldn't take the whole app down; log and start clean.
		console.error('[state] Failed to load deck.json, starting empty:', err.message);
		deck = {
			currentIndex: 0,
			slides: [],
			blackout: false,
			backgroundOn: false,
			backgroundUrl: DEFAULT_BG_URL,
		};
	}
	return deck;
}

// Debounced persistence. We schedule a write ~250ms after the last change so a
// stream of keystrokes results in a single disk write, not dozens.
function scheduleSave() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(saveNow, 250);
}

// Force an immediate write of the current deck to disk. Also cancels any
// pending debounced write so a short-lived process (import CLI, tests) does
// not exit with a timer still hanging, and does not double-write.
function saveNow() {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	ensureDataDir();
	try {
		fs.writeFileSync(DECK_FILE, JSON.stringify(deck, null, 2), 'utf8');
	} catch (err) {
		console.error('[state] Failed to save deck.json:', err.message);
	}
}

// Keep currentIndex within valid bounds no matter what mutation just happened
// (e.g. we deleted the last slide while presenting it). An empty deck sits at 0.
function clampIndex() {
	if (deck.slides.length === 0) {
		deck.currentIndex = 0;
		return;
	}
	if (deck.currentIndex < 0) deck.currentIndex = 0;
	if (deck.currentIndex > deck.slides.length - 1) {
		deck.currentIndex = deck.slides.length - 1;
	}
}

// Return the current deck object (live reference; callers should treat as read-only).
function getDeck() {
	return deck;
}

// Replace the entire deck (used by the importer). Resets to the first slide.
function replaceDeck({ slides }) {
	deck = {
		currentIndex: 0,
		slides: (slides || []).map((s) => ({ id: s.id || newId(), text: s.text || '' })),
		blackout: false,
		backgroundOn: deck.backgroundOn === true,
		backgroundUrl: deck.backgroundUrl || DEFAULT_BG_URL,
	};
	clampIndex();
	scheduleSave();
	return deck;
}

// -----------------------------------------------------------------------------
// Mutations. Each returns the updated deck so the caller can broadcast it.
// -----------------------------------------------------------------------------

// Move the presentation pointer. action is 'next' | 'prev' | 'goto'.
function navigate({ action, index }) {
	if (action === 'next') deck.currentIndex += 1;
	else if (action === 'prev') deck.currentIndex -= 1;
	else if (action === 'goto' && Number.isInteger(index)) deck.currentIndex = index;
	clampIndex();
	scheduleSave();
	return deck;
}

// Edit the body text of a single slide, identified by id.
function editSlide({ id, text }) {
	const slide = deck.slides.find((s) => s.id === id);
	if (slide) {
		slide.text = typeof text === 'string' ? text : '';
		scheduleSave();
	}
	return deck;
}

// Insert a new blank slide immediately AFTER the given index. Passing -1 (or
// anything < 0) inserts at the very beginning. The new slide becomes current
// so the presenter/editor can see it right away.
function addSlide({ afterIndex }) {
	const slide = { id: newId(), text: '' };
	let insertAt;
	if (!Number.isInteger(afterIndex) || afterIndex < -1) {
		insertAt = deck.slides.length; // default: append at end
	} else {
		insertAt = afterIndex + 1;
	}
	if (insertAt < 0) insertAt = 0;
	if (insertAt > deck.slides.length) insertAt = deck.slides.length;
	deck.slides.splice(insertAt, 0, slide);
	deck.currentIndex = insertAt;
	clampIndex();
	scheduleSave();
	return deck;
}

// Duplicate a slide by id, inserting the copy immediately AFTER the original.
// The projector pointer (currentIndex) stays on the same slide: we only bump
// it if the insert happened *before* the current slide (so the same lyrics
// stay on screen). A new id is generated so the copy is independently editable.
function duplicateSlide({ id }) {
	const idx = deck.slides.findIndex((s) => s.id === id);
	if (idx === -1) return deck;
	const source = deck.slides[idx];
	const copy = { id: newId(), text: typeof source.text === 'string' ? source.text : '' };
	deck.slides.splice(idx + 1, 0, copy);
	// Inserted at idx+1. If that is at-or-before the current slide, the current
	// slide shifted right by one and we must follow it.
	if (idx < deck.currentIndex) deck.currentIndex += 1;
	clampIndex();
	scheduleSave();
	return deck;
}

// Remove a slide by id. currentIndex is re-clamped afterward.
function removeSlide({ id }) {
	const idx = deck.slides.findIndex((s) => s.id === id);
	if (idx !== -1) {
		deck.slides.splice(idx, 1);
		// If we removed a slide before the current one, shift the pointer left so
		// the same slide stays on screen where possible.
		if (idx < deck.currentIndex) deck.currentIndex -= 1;
		clampIndex();
		scheduleSave();
	}
	return deck;
}

// Reorder the entire slide list to match the given array of ids. Any ids not
// present are ignored; any existing slides missing from the list are appended
// at the end so we never silently drop content.
function reorder({ orderedIds }) {
	if (!Array.isArray(orderedIds)) return deck;
	const byId = new Map(deck.slides.map((s) => [s.id, s]));
	const currentId = deck.slides[deck.currentIndex]?.id;
	const next = [];
	for (const id of orderedIds) {
		const s = byId.get(id);
		if (s) {
			next.push(s);
			byId.delete(id);
		}
	}
	// Append leftovers to guarantee no data loss.
	for (const s of byId.values()) next.push(s);
	deck.slides = next;
	// Keep the same slide "current" after reordering.
	if (currentId) {
		const newIdx = deck.slides.findIndex((s) => s.id === currentId);
		if (newIdx !== -1) deck.currentIndex = newIdx;
	}
	clampIndex();
	scheduleSave();
	return deck;
}

// Toggle (or explicitly set) the presentation blackout. When on, the viewer
// hides lyrics and overlays so the projector is a pure black screen. The
// current slide is unchanged — turning blackout off reveals the same slide.
function setBlackout({ on }) {
	if (typeof on === 'boolean') {
		deck.blackout = on;
	} else {
		deck.blackout = !deck.blackout;
	}
	scheduleSave();
	return deck;
}

// Toggle (or set) the background image, and/or point at a new image URL.
function setBackground({ on, url }) {
	if (typeof on === 'boolean') {
		deck.backgroundOn = on;
	} else if (on === undefined && url === undefined) {
		deck.backgroundOn = !deck.backgroundOn;
	}
	if (typeof url === 'string' && url) {
		deck.backgroundUrl = url;
	}
	scheduleSave();
	return deck;
}

module.exports = {
	newId,
	loadDeck,
	getDeck,
	replaceDeck,
	navigate,
	editSlide,
	addSlide,
	duplicateSlide,
	removeSlide,
	reorder,
	setBlackout,
	setBackground,
	saveNow,
	DEFAULT_BG_URL,
	DECK_FILE,
};
