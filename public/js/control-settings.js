// control-settings.js
// -----------------------------------------------------------------------------
// Settings panel for projector display knobs. The panel is "dumb" about
// sockets: it reads/writes the form + localStorage and calls onChange with
// a normalized settings object. control.js sends that over the WebSocket.
//
// Reset to defaults writes DEFAULTS back to the form and localStorage, then
// fires onChange so the projector snaps back immediately.
// -----------------------------------------------------------------------------

window.ControlSettings = (function () {
	const FIELD = {
		crossfadeMs: 'set-crossfade-ms',
		bgCrossfadeMultiplier: 'set-bg-multiplier',
		fitMinPx: 'set-fit-min',
		fitMaxPx: 'set-fit-max',
		tvSafePadY: 'set-pad-y',
		tvSafePadX: 'set-pad-x',
		showCursor: 'set-show-cursor',
	};

	function el({ id }) {
		return document.getElementById(id);
	}

	function readForm() {
		return window.DisplaySettings.normalize({
			raw: {
				crossfadeMs: el({ id: FIELD.crossfadeMs }).value,
				bgCrossfadeMultiplier: el({ id: FIELD.bgCrossfadeMultiplier }).value,
				fitMinPx: el({ id: FIELD.fitMinPx }).value,
				fitMaxPx: el({ id: FIELD.fitMaxPx }).value,
				tvSafePadY: el({ id: FIELD.tvSafePadY }).value,
				tvSafePadX: el({ id: FIELD.tvSafePadX }).value,
				showCursor: el({ id: FIELD.showCursor }).checked,
			},
		});
	}

	function writeForm({ settings }) {
		const s = window.DisplaySettings.normalize({ raw: settings });
		el({ id: FIELD.crossfadeMs }).value = String(s.crossfadeMs);
		el({ id: FIELD.bgCrossfadeMultiplier }).value = String(s.bgCrossfadeMultiplier);
		el({ id: FIELD.fitMinPx }).value = String(s.fitMinPx);
		el({ id: FIELD.fitMaxPx }).value = String(s.fitMaxPx);
		el({ id: FIELD.tvSafePadY }).value = String(s.tvSafePadY);
		el({ id: FIELD.tvSafePadX }).value = String(s.tvSafePadX);
		el({ id: FIELD.showCursor }).checked = s.showCursor === true;
		return s;
	}

	function setPanelOpen({ open }) {
		const panel = el({ id: 'settings-panel' });
		const btn = el({ id: 'btn-settings' });
		if (!panel || !btn) return;
		panel.hidden = !open;
		btn.setAttribute('aria-expanded', open ? 'true' : 'false');
		btn.classList.toggle('is-on', open);
	}

	function bind({ onChange }) {
		const stored = window.DisplaySettings.loadFromStorage();
		writeForm({ settings: stored });

		let timer = null;
		function emit({ settings }) {
			const next = window.DisplaySettings.saveToStorage({ settings });
			writeForm({ settings: next });
			if (typeof onChange === 'function') onChange({ settings: next });
		}

		function onFieldChange() {
			if (timer) clearTimeout(timer);
			// Short debounce so spinner clicks / typing coalesce into one send
			// without feeling laggy on the projector.
			timer = setTimeout(() => {
				timer = null;
				emit({ settings: readForm() });
			}, 80);
		}

		Object.values(FIELD).forEach((id) => {
			const node = el({ id });
			if (!node) return;
			node.addEventListener('input', onFieldChange);
			node.addEventListener('change', onFieldChange);
		});

		el({ id: 'btn-settings' }).addEventListener('click', () => {
			const panel = el({ id: 'settings-panel' });
			setPanelOpen({ open: panel.hidden });
		});
		el({ id: 'btn-settings-close' }).addEventListener('click', () => {
			setPanelOpen({ open: false });
		});
		el({ id: 'settings-backdrop' }).addEventListener('click', () => {
			setPanelOpen({ open: false });
		});

		// Reset: drop localStorage overrides and push the original present.js
		// const values (DEFAULTS) to the projector immediately.
		el({ id: 'btn-settings-reset' }).addEventListener('click', () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			emit({ settings: window.DisplaySettings.DEFAULTS });
		});

		return {
			getSettings: () => window.DisplaySettings.loadFromStorage(),
			setPanelOpen,
		};
	}

	return { bind };
})();
