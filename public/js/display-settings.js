// display-settings.js (browser)
// -----------------------------------------------------------------------------
// MUST stay in lockstep with server/display-settings.js: same DEFAULTS keys
// and the same normalize() clamping. Control uses this for the Settings
// panel + localStorage. Presentation uses it to apply a state push safely.
//
// Also module.exports so Node tests can require this file.
// -----------------------------------------------------------------------------

(function attachDisplaySettings(global) {
	const STORAGE_KEY = 'quickslides.displaySettings';

	const DEFAULTS = {
		tvSafePadY: 0.06,
		tvSafePadX: 0.08,
		fitMinPx: 56,
		fitMaxPx: 72,
		showCursor: true,
		crossfadeMs: 500,
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

	function normalize({ raw }) {
		const src = raw && typeof raw === 'object' ? raw : {};
		let fitMinPx = Math.round(
			clampNumber({ value: src.fitMinPx, min: 8, max: 400, fallback: DEFAULTS.fitMinPx })
		);
		let fitMaxPx = Math.round(
			clampNumber({ value: src.fitMaxPx, min: 8, max: 400, fallback: DEFAULTS.fitMaxPx })
		);
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
				clampNumber({
					value: src.crossfadeMs,
					min: 0,
					max: 20000,
					fallback: DEFAULTS.crossfadeMs,
				})
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

	function loadFromStorage() {
		try {
			if (typeof localStorage === 'undefined') return normalize({ raw: {} });
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return normalize({ raw: {} });
			return normalize({ raw: JSON.parse(raw) });
		} catch {
			return normalize({ raw: {} });
		}
	}

	function saveToStorage({ settings }) {
		const next = normalize({ raw: settings });
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			}
		} catch {
			// Private mode / quota — still return the normalized values so the
			// live session works even if we cannot persist.
		}
		return next;
	}

	const api = {
		DEFAULTS,
		STORAGE_KEY,
		normalize,
		bgCrossfadeMs,
		loadFromStorage,
		saveToStorage,
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (global) {
		global.DisplaySettings = api;
	}
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
