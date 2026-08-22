// control-preview.js
// -----------------------------------------------------------------------------
// Right-hand projector preview in the CONTROL window. Renders the selected
// slide (or live textarea text) into a stage that matches the live
// Presentation window's aspect ratio (falls back to 16:9 until /present
// reports a size). window.SlideFit keeps wrapping/relative font size in
// sync with /present.
//
// Does NOT talk to the socket. Pure display. Exposed as window.ControlPreview.
// -----------------------------------------------------------------------------

window.ControlPreview = (function () {
	let frameEl = null;
	let stageEl = null;
	let slideEl = null;
	let bgEl = null;
	let lastText = null;
	let lastLive = false;
	let resizeRaf = null;
	let liveBadgeEl = null;
	// Live Presentation inner size. null = no presenter has checked in yet.
	let viewport = null;

	function stageRatio() {
		if (viewport && viewport.height > 0) return viewport.width / viewport.height;
		return 16 / 9;
	}

	function sizeStage() {
		if (!frameEl || !stageEl) return;
		const fw = frameEl.clientWidth;
		const fh = frameEl.clientHeight;
		if (fw <= 0 || fh <= 0) return;
		const ratio = stageRatio();
		let w = fw;
		let h = w / ratio;
		if (h > fh) {
			h = fh;
			w = h * ratio;
		}
		stageEl.style.width = Math.floor(w) + 'px';
		stageEl.style.height = Math.floor(h) + 'px';
	}

	function setViewport({ width, height }) {
		const w = Math.round(Number(width));
		const h = Math.round(Number(height));
		if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
		if (viewport && viewport.width === w && viewport.height === h) return;
		viewport = { width: w, height: h };
		if (window.SlideFit && typeof window.SlideFit.configure === 'function') {
			window.SlideFit.configure({ projectorWidth: w });
		}
		paint({ text: lastText || '' });
	}

	function paint({ text, live }) {
		if (!stageEl || !slideEl) return;
		sizeStage();
		window.SlideFit.render({ stageEl, slideEl, text });
		lastText = text;
		if (typeof live === 'boolean') lastLive = live;
		stageEl.classList.toggle('is-live', lastLive === true);
		if (liveBadgeEl) liveBadgeEl.hidden = lastLive !== true;
	}

	function setBackground({ on, url }) {
		if (!bgEl) bgEl = document.getElementById('preview-bg');
		if (!bgEl) return;
		const next = url ? `url("${url}")` : '';
		if (bgEl.style.backgroundImage !== next) bgEl.style.backgroundImage = next;
		bgEl.classList.toggle('is-on', !!(on && url));
	}

	function bind({ frame, stage, slide }) {
		frameEl = frame;
		stageEl = stage;
		slideEl = slide;
		bgEl = document.getElementById('preview-bg');
		liveBadgeEl = document.getElementById('preview-live-badge');

		function onResize() {
			if (resizeRaf) cancelAnimationFrame(resizeRaf);
			resizeRaf = requestAnimationFrame(() => {
				resizeRaf = null;
				paint({ text: lastText || '' });
			});
		}
		window.addEventListener('resize', onResize);
		if (typeof ResizeObserver === 'function') {
			new ResizeObserver(onResize).observe(frameEl);
		}
	}

	return { bind, paint, setBackground, setViewport };
})();
