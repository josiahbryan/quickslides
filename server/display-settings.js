// display-settings.js (server)
// -----------------------------------------------------------------------------
// Projector display knobs that used to live as consts at the top of present.js.
// The Control window edits these; they ride along on every full-state broadcast
// so /present can apply them live (no Cmd+R).
//
// Defaults MUST match public/js/display-settings.js (the browser mirror).
// A unit test compares the two objects so they cannot drift.
//
// These are NOT persisted in data/deck.json. Control stores them in
// localStorage and re-pushes on every socket connect. The server only holds
// the last values in memory so a Presentation window that connects first
// still gets *something* (defaults until Control sends).
// -----------------------------------------------------------------------------

const DEFAULTS = {
	// Fractions of the viewport, applied to both matching edges.
	tvSafePadY: 0.06,
	tvSafePadX: 0.08,
	// Lyric font floor / cap in projector pixels (preview scales these down).
	fitMinPx: 56,
	fitMaxPx: 72,
	showCursor: true,
	crossfadeMs: 500,
	// BG fade duration = crossfadeMs * this multiplier.
	bgCrossfadeMultiplier: 3,
};

function clampNumber({ value, min, max, fallback }) {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function parseBoolean({ value, fallback }) {
	if (typeof value === 'boolean') return value;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return fallback;
}

// Coerce a partial/dirty object into a full, safe settings record.
// Unknown keys are dropped. Out-of-range numbers are clamped. Missing
// fields fall back to DEFAULTS so an old localStorage blob still works.
function normalize({ raw }) {
	const src = raw && typeof raw === 'object' ? raw : {};
	let fitMinPx = Math.round(
		clampNumber({ value: src.fitMinPx, min: 8, max: 400, fallback: DEFAULTS.fitMinPx })
	);
	let fitMaxPx = Math.round(
		clampNumber({ value: src.fitMaxPx, min: 8, max: 400, fallback: DEFAULTS.fitMaxPx })
	);
	// Floor cannot sit above the cap — swap rather than silently ignore.
	if (fitMinPx > fitMaxPx) {
		const tmp = fitMinPx;
		fitMinPx = fitMaxPx;
		fitMaxPx = tmp;
	}
	return {
		tvSafePadY: clampNumber({
			value: src.tvSafePadY,
			min: 0,
			max: 0.4,
			fallback: DEFAULTS.tvSafePadY,
		}),
		tvSafePadX: clampNumber({
			value: src.tvSafePadX,
			min: 0,
			max: 0.4,
			fallback: DEFAULTS.tvSafePadX,
		}),
		fitMinPx,
		fitMaxPx,
		showCursor: parseBoolean({ value: src.showCursor, fallback: DEFAULTS.showCursor }),
		crossfadeMs: Math.round(
			clampNumber({ value: src.crossfadeMs, min: 0, max: 20000, fallback: DEFAULTS.crossfadeMs })
		),
		bgCrossfadeMultiplier: clampNumber({
			value: src.bgCrossfadeMultiplier,
			min: 0.1,
			max: 20,
			fallback: DEFAULTS.bgCrossfadeMultiplier,
		}),
	};
}

function bgCrossfadeMs({ settings }) {
	const s = settings || DEFAULTS;
	return Math.round(s.crossfadeMs * s.bgCrossfadeMultiplier);
}

module.exports = { DEFAULTS, normalize, bgCrossfadeMs };
