// control-preview.js
// -----------------------------------------------------------------------------
// Right-hand projector preview in the CONTROL window. Renders the selected
// slide (or live textarea text) into a 16:9 black stage using window.SlideFit
// so layout/wrapping/relative font size match /present.
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

	function sizeStageTo16x9() {
		if (!frameEl || !stageEl) return;
		const fw = frameEl.clientWidth;
		const fh = frameEl.clientHeight;
		if (fw <= 0 || fh <= 0) return;
		const ratio = 16 / 9;
		let w = fw;
		let h = w / ratio;
		if (h > fh) {
			h = fh;
			w = h * ratio;
		}
		stageEl.style.width = Math.floor(w) + 'px';
		stageEl.style.height = Math.floor(h) + 'px';
	}

	function paint({ text, live }) {
		if (!stageEl || !slideEl) return;
		sizeStageTo16x9();
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

	return { bind, paint, setBackground };
})();
