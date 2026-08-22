// slide-fit.js
// -----------------------------------------------------------------------------
// Shared lyric layout used by the CONTROL preview pane. Mirrors the presenter
// fit rules (TV-safe padding, min/max font, wrap-at-floor) so the operator
// sees the same wrapping/size they will get on the projector.
//
// Font min/max in present.js are pixel sizes for a ~1920-wide projector. The
// preview stage is much smaller, so we scale those px values by
// stageWidth / PROJECTOR_W. Padding fractions scale themselves.
//
// Keep the numeric constants here in sync with public/js/present.js.
// Exposed as window.SlideFit (plain <script>, no bundler).
// -----------------------------------------------------------------------------

window.SlideFit = (function () {
	// Defaults match DisplaySettings.DEFAULTS / the old present.js consts.
	// ControlSettings calls configure() so the preview tracks the Settings panel.
	let TV_SAFE_PAD_Y = 0.06;
	let TV_SAFE_PAD_X = 0.08;
	let FIT_MAX_PX = 72;
	let FIT_MIN_PX = 56;
	// Font min/max are calibrated for the live Presentation window width.
	// Until /present reports a size we assume a 1920-wide projector.
	let PROJECTOR_W = 1920;

	function configure({ settings, projectorWidth }) {
		if (settings) {
			const s = window.DisplaySettings
				? window.DisplaySettings.normalize({ raw: settings || {} })
				: settings || {};
			if (typeof s.tvSafePadY === 'number') TV_SAFE_PAD_Y = s.tvSafePadY;
			if (typeof s.tvSafePadX === 'number') TV_SAFE_PAD_X = s.tvSafePadX;
			if (typeof s.fitMaxPx === 'number') FIT_MAX_PX = s.fitMaxPx;
			if (typeof s.fitMinPx === 'number') FIT_MIN_PX = s.fitMinPx;
		}
		if (Number.isFinite(projectorWidth) && projectorWidth > 0) {
			PROJECTOR_W = projectorWidth;
		}
	}

	function linesFromText({ text }) {
		const raw = typeof text === 'string' ? text : '';
		return raw.split('\n').map((line) => (line.length === 0 ? '\u00a0' : line));
	}

	function buildLines({ slideEl, lines }) {
		slideEl.textContent = '';
		slideEl.classList.remove('placeholder');
		const frag = document.createDocumentFragment();
		for (const line of lines) {
			const lineEl = document.createElement('div');
			lineEl.className = 'line';
			lineEl.textContent = line;
			frag.appendChild(lineEl);
		}
		slideEl.appendChild(frag);
	}

	function applyTvSafePadding({ stageEl }) {
		const viewW = stageEl.clientWidth;
		const viewH = stageEl.clientHeight;
		const padX = Math.round(viewW * TV_SAFE_PAD_X);
		const padY = Math.round(viewH * TV_SAFE_PAD_Y);
		stageEl.style.padding = `${padY}px ${padX}px`;
		return {
			availW: Math.max(0, viewW - padX * 2),
			availH: Math.max(0, viewH - padY * 2),
			scale: viewW / PROJECTOR_W,
		};
	}

	function fitText({ stageEl, slideEl }) {
		const { availW, availH, scale } = applyTvSafePadding({ stageEl });
		if (slideEl.classList.contains('placeholder')) return;
		if (!slideEl.firstChild) return;
		if (availW <= 0 || availH <= 0) return;

		const minPx = Math.max(4, FIT_MIN_PX * scale);
		const maxPx = Math.max(minPx, FIT_MAX_PX * scale);

		slideEl.classList.remove('wrapping');
		slideEl.style.maxWidth = '';

		let lo = Math.floor(minPx);
		let hi = Math.max(lo, Math.min(Math.floor(maxPx), Math.floor(availH)));
		let best = lo;

		while (lo <= hi) {
			const mid = Math.floor((lo + hi) / 2);
			slideEl.style.fontSize = mid + 'px';
			const fits = slideEl.scrollWidth <= availW && slideEl.scrollHeight <= availH;
			if (fits) {
				best = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}

		slideEl.style.fontSize = best + 'px';
		if (slideEl.scrollWidth > availW) {
			slideEl.classList.add('wrapping');
			slideEl.style.maxWidth = availW + 'px';
			slideEl.style.fontSize = Math.floor(minPx) + 'px';
		}
	}

	function render({ stageEl, slideEl, text }) {
		const body = typeof text === 'string' ? text : '';
		if (!body.trim()) {
			slideEl.textContent = 'No slide';
			slideEl.classList.add('placeholder');
			slideEl.classList.remove('wrapping');
			slideEl.style.fontSize = '';
			slideEl.style.maxWidth = '';
			applyTvSafePadding({ stageEl });
			return;
		}
		buildLines({ slideEl, lines: linesFromText({ text: body }) });
		fitText({ stageEl, slideEl });
	}

	return {
		configure,
		PROJECTOR_W,
		linesFromText,
		render,
	};
})();
