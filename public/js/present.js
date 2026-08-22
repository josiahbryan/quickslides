// present.js
// -----------------------------------------------------------------------------
// The PRESENTATION (viewer) window logic. This window is VIEW-ONLY: it has no
// editing controls. Its whole job is:
//   1. Connect to the server via the shared SlideSocket (auto-reconnecting).
//   2. On every full-state push, render ONLY the current slide as large,
//      centered, high-contrast text suitable for projecting worship lyrics.
//   3. Auto-fit that text so it is as big as possible while still fitting the
//      viewport, recomputing on window resize and whenever the slide changes.
//   4. Show tiny, unobtrusive operator overlays: a connection dot + a counter.
//
// Because the server broadcasts the ENTIRE deck state on every change, we never
// need diffing: we just re-render whenever the visible slide actually changes.
// This makes navigation, live text edits, add/remove, and reorder all "just
// work" with a single code path.
//
// Style: vanilla JS, no framework, no default exports. Wrapped in an IIFE so we
// don't leak helpers onto window. Our own helpers take a single named-parameter
// object for clarity.
// -----------------------------------------------------------------------------

(function () {
	'use strict';

	// --- Cache the DOM nodes we touch on every render (grab once at startup) ---
	const stageEl = document.getElementById('stage'); // full-screen surface (sizing reference)
	const slideEl = document.getElementById('slide'); // holds the current slide's lines
	const slideOutEl = document.getElementById('slide-out'); // departing clone for crossfade
	const bgEl = document.getElementById('stage-bg'); // optional background photo
	const statusEl = document.getElementById('status'); // connection dot
	const counterEl = document.getElementById('counter'); // "12 / 247" text

	// =========================================================================
	// TV-SAFE PROJECTION PADDING — TWEAK THESE TWO.
	// File: public/js/present.js  (this file, the two consts just below)
	//
	// TVs / some projectors overscan: they crop a strip off every edge. These
	// two fractions keep lyrics (and the tiny operator overlays) inside the
	// "safe" inner rectangle.
	//
	// Values are a FRACTION of the viewport, applied to BOTH matching edges:
	//   TV_SAFE_PAD_Y = 0.06  ->  6% of height as padding on TOP and on BOTTOM
	//   TV_SAFE_PAD_X = 0.08  ->  8% of width  as padding on LEFT and on RIGHT
	//
	// NO HMR. This app serves vanilla JS with no bundler. After you change a
	// const, hard-refresh the Presentation tab (Cmd+R). The Control tab does
	// not need a reload for this; only /present reads these numbers.
	// =========================================================================
	const TV_SAFE_PAD_Y = 0.06;
	const TV_SAFE_PAD_X = 0.08;

	// Hard cap on lyric font-size (px). Auto-fit still shrinks long slides to
	// fit the TV-safe box, but short slides ("Amen", one line) stop growing
	// here so they don't fill the entire screen. Tweak this; then Cmd+R on
	// /present (no HMR, no server restart).
	const FIT_MAX_PX = 72;

	// Floor (px). We never shrink below this. If a line is still too wide at
	// this size, we wrap it (see .slide.wrapping) instead of going smaller.
	const FIT_MIN_PX = 56;

	// Show the mouse pointer on the presentation window. Default ON so you can
	// aim a clicker/trackpad at the projector window. Set false and Cmd+R
	// /present to hide it (no HMR).
	const SHOW_CURSOR = true;

	// Overlap crossfade duration (ms). Incoming fades in while outgoing fades
	// out. Tweak this; then Cmd+R /present (no HMR).
	const CROSSFADE_MS = 500;

	// Remember what we last rendered so we can (a) skip redundant re-renders and
	// (b) only play the fade-in animation when the VISIBLE slide truly changed.
	// The signature encodes both which slide and its exact text, so a live edit to
	// the current slide still counts as a change.
	let lastRenderSignature = null;

	// -------------------------------------------------------------------------
	// escapeToLines: turn a slide's raw text string into an array of safe line
	// strings. We split ONLY on '\n' (the model stores one string per slide with
	// embedded newlines). We never build HTML from this text; callers insert each
	// line via textContent, so this function just handles the splitting + keeping
	// blank lines visible (a blank line becomes a non-breaking space so it still
	// occupies vertical space, preserving the authored spacing between stanzas).
	// -------------------------------------------------------------------------
	function escapeToLines({ text }) {
		const raw = typeof text === 'string' ? text : '';
		return raw.split('\n').map((line) => (line.length === 0 ? '\u00a0' : line));
	}

	// -------------------------------------------------------------------------
	// buildSlideLines: (re)populate #slide with one <div class="line"> per line.
	// We use textContent (never innerHTML) so slide content is ALWAYS treated as
	// plain text and can never inject markup/scripts into the viewer.
	// -------------------------------------------------------------------------
	function buildSlideLines({ lines }) {
		// Clear any previous content first.
		slideEl.textContent = '';
		slideEl.classList.remove('placeholder');

		// Build each line as its own centered block element. Using a fragment keeps
		// this to a single DOM insertion (one reflow) instead of one per line.
		const frag = document.createDocumentFragment();
		for (const line of lines) {
			const lineEl = document.createElement('div');
			lineEl.className = 'line';
			lineEl.textContent = line; // <-- escaping: plain text, no HTML injection
			frag.appendChild(lineEl);
		}
		slideEl.appendChild(frag);
	}

	// -------------------------------------------------------------------------
	// showPlaceholder: render the subtle "No slide" state when the deck is empty
	// or currentIndex points at nothing. Styled small/dim via the .placeholder
	// class so it never reads as actual content.
	// -------------------------------------------------------------------------
	function showPlaceholder() {
		slideEl.textContent = 'No slide';
		slideEl.classList.add('placeholder');
		// Placeholder uses a fixed CSS size, so we do NOT run the fit routine on
		// it — but we still apply TV-safe padding so the dim label + overlays
		// sit inside the overscan-safe box on an empty deck too.
		tvSafeInnerSize();
	}

	// -------------------------------------------------------------------------
	// tvSafeInnerSize: compute the pixel padding implied by the two TV-safe
	// fractions, apply it as real CSS padding on the stage (so lyrics are
	// visually inset, not just "fitted smaller"), and park the operator
	// overlays inside that same safe rectangle so they don't get cropped by
	// overscan either. Returns the remaining inner width/height the fitter
	// is allowed to fill.
	// -------------------------------------------------------------------------
	function tvSafeInnerSize() {
		const viewW = stageEl.clientWidth;
		const viewH = stageEl.clientHeight;
		const padX = Math.round(viewW * TV_SAFE_PAD_X);
		const padY = Math.round(viewH * TV_SAFE_PAD_Y);

		// box-sizing: border-box is on *, so this padding shrinks the content
		// box the slide sits in. Flex centering then keeps lyrics in the middle
		// of that inner box.
		stageEl.style.padding = `${padY}px ${padX}px`;

		// Overlays are position:fixed to the viewport, so they ignore stage
		// padding. Nudge them inward by the same pad so they stay TV-safe too.
		statusEl.style.left = `${padX + 8}px`;
		statusEl.style.bottom = `${padY + 8}px`;
		counterEl.style.right = `${padX + 8}px`;
		counterEl.style.bottom = `${padY + 8}px`;

		return {
			availW: Math.max(0, viewW - padX * 2),
			availH: Math.max(0, viewH - padY * 2),
		};
	}

	// -------------------------------------------------------------------------
	// fitText: the auto-fit heart of the viewer. Find the LARGEST font-size (px)
	// at which the whole slide block fits within the TV-safe inner rectangle on
	// BOTH axes, then apply it. We use a binary search over font-size:
	//
	//   - Lower bound = FIT_MIN_PX (we never go smaller than this).
	//   - Upper bound = min(FIT_MAX_PX, inner height) so short slides don't
	//     explode to fill the whole screen.
	//   - Measure in nowrap mode so each authored line stays one line while we
	//     search for the largest size that fits both axes.
	//   - If even FIT_MIN_PX overflows the width, enable wrapping at that
	//     floor instead of shrinking further (readable over "tiny and one line").
	// -------------------------------------------------------------------------
	function fitText() {
		// Always re-apply padding first so a resize updates the safe box even
		// when there is no slide text to fit (placeholder / empty deck).
		const { availW, availH } = tvSafeInnerSize();

		// Nothing to fit for the placeholder (fixed size) or an empty block.
		if (slideEl.classList.contains('placeholder')) return;
		if (!slideEl.firstChild) return;

		if (availW <= 0 || availH <= 0) return; // window not laid out yet

		// Measure unwrapped first. Clear any wrap leftover from the previous
		// (possibly longer) slide so the width search sees true single-line size.
		slideEl.classList.remove('wrapping');
		slideEl.style.maxWidth = '';

		let lo = FIT_MIN_PX;
		// Never search above FIT_MAX_PX, and never above the safe box height.
		let hi = Math.max(FIT_MIN_PX, Math.min(FIT_MAX_PX, Math.floor(availH)));
		let best = FIT_MIN_PX;

		// Standard "largest value that satisfies a monotonic predicate" binary
		// search: bigger font -> bigger block, so "fits" flips from true to false
		// exactly once as size increases, which binary search can exploit.
		while (lo <= hi) {
			const mid = Math.floor((lo + hi) / 2);
			slideEl.style.fontSize = mid + 'px';

			// scrollWidth/Height reflect the block's true content extent (including
			// any overflow), which is exactly what we must keep within the stage.
			const fits = slideEl.scrollWidth <= availW && slideEl.scrollHeight <= availH;

			if (fits) {
				best = mid; // this size works; try to go bigger
				lo = mid + 1;
			} else {
				hi = mid - 1; // too big; go smaller
			}
		}

		slideEl.style.fontSize = best + 'px';

		// Floor hit and still too wide (or never found a nowrap fit): wrap at
		// FIT_MIN_PX rather than shrinking. Constraining maxWidth gives each
		// .line a wrap point equal to the TV-safe inner width.
		if (slideEl.scrollWidth > availW) {
			slideEl.classList.add('wrapping');
			slideEl.style.maxWidth = availW + 'px';
			slideEl.style.fontSize = FIT_MIN_PX + 'px';
		}
	}

	// -------------------------------------------------------------------------
	// updateCounter: refresh the small "current / total" operator readout. Shows
	// a 1-based index (humans count from 1) and blanks out when there are no
	// slides so we don't display a meaningless "1 / 0".
	// -------------------------------------------------------------------------
	function updateCounter({ currentIndex, total }) {
		if (!total || total <= 0) {
			counterEl.textContent = '';
			return;
		}
		// Clamp the displayed index defensively so it always reads sensibly even if
		// a transient state has an out-of-range currentIndex.
		const human = Math.min(Math.max(currentIndex + 1, 1), total);
		counterEl.textContent = `${human} / ${total}`;
	}

	// -------------------------------------------------------------------------
	// Crossfade: snapshot the outgoing slide into #slide-out, then fade that
	// clone out while #slide (the incoming content, already rebuilt) fades in.
	// Both layers are absolutely centered, so they occupy the same pixels.
	// Rapid advances replace the departing clone with whatever is currently
	// showing so we never stack leftover ghosts.
	// -------------------------------------------------------------------------
	let leaveTimer = null;

	function snapshotOutgoing() {
		const outgoingHasContent = slideOutEl && (slideEl.childNodes.length > 0 || slideEl.textContent);
		if (!outgoingHasContent) return;

		slideOutEl.className = 'slide';
		if (slideEl.classList.contains('wrapping')) slideOutEl.classList.add('wrapping');
		if (slideEl.classList.contains('placeholder')) slideOutEl.classList.add('placeholder');
		slideOutEl.style.fontSize = slideEl.style.fontSize;
		slideOutEl.style.maxWidth = slideEl.style.maxWidth;
		// Clone via the DOM (not innerHTML) so we never re-parse slide text
		// as markup. These nodes are copies of textContent-built lines.
		slideOutEl.replaceChildren(
			...Array.from(slideEl.childNodes).map((node) => node.cloneNode(true))
		);
		void slideOutEl.offsetWidth;
		slideOutEl.classList.add('slide-leave');
		if (leaveTimer) clearTimeout(leaveTimer);
		leaveTimer = setTimeout(() => {
			slideOutEl.replaceChildren();
			slideOutEl.className = 'slide slide-out';
			leaveTimer = null;
		}, CROSSFADE_MS + 30);
	}

	function playIncomingFade() {
		slideEl.classList.remove('slide-enter');
		void slideEl.offsetWidth;
		slideEl.classList.add('slide-enter');
	}

	// -------------------------------------------------------------------------
	// render: the single entry point invoked on every server state push. It
	// figures out the current slide, and—only if the VISIBLE content changed—
	// rebuilds the DOM, fades it in, and refits the text. The counter is always
	// refreshed (cheap) so it stays correct even when only the total changes.
	// -------------------------------------------------------------------------
	function render({ state }) {
		// Be defensive about the incoming shape; a malformed push shouldn't crash
		// the projector mid-service.
		const slides = state && Array.isArray(state.slides) ? state.slides : [];
		const currentIndex = state && Number.isInteger(state.currentIndex) ? state.currentIndex : 0;
		const total = slides.length;
		const slide = slides[currentIndex];

		// Blackout is independent of which slide is current. Apply it on EVERY
		// state push (including ones that would otherwise be signature-skipped)
		// so toggling Black hides/shows instantly without rebuilding the slide.
		// body.blackout CSS hides slide + overlays; the stage stays pure black.
		document.body.classList.toggle('blackout', state && state.blackout === true);

		// Background is independent of the current slide. Apply on every push
		// (including signature-skipped ones) so the fade happens immediately.
		if (bgEl) {
			const url = state && typeof state.backgroundUrl === 'string' ? state.backgroundUrl : '';
			const nextBg = url ? `url("${url}")` : '';
			if (bgEl.style.backgroundImage !== nextBg) {
				bgEl.style.backgroundImage = nextBg;
			}
			bgEl.classList.toggle('is-on', !!(state && state.backgroundOn && url));
		}

		// Always keep the operator counter in sync (this is cheap and independent
		// of whether the visible slide text changed).
		updateCounter({ currentIndex, total });

		// Build a signature of exactly what's on screen. If it hasn't changed we
		// skip the DOM work and the fade (avoids flicker on unrelated state pushes,
		// e.g. an edit to some OTHER slide the viewer isn't showing).
		const signature = slide ? `${currentIndex}\u0000${slide.text}` : '__none__';
		if (signature === lastRenderSignature) return;
		lastRenderSignature = signature;

		if (!slide) {
			snapshotOutgoing();
			showPlaceholder();
			playIncomingFade();
			return;
		}

		// Snapshot outgoing FIRST, then rebuild incoming, fit, fade in.
		snapshotOutgoing();
		const lines = escapeToLines({ text: slide.text });
		buildSlideLines({ lines });
		fitText();
		playIncomingFade();
	}

	// -------------------------------------------------------------------------
	// setConnected: drive the tiny connection dot from the socket's status
	// callback. Green = connected, dim red = disconnected/reconnecting.
	// -------------------------------------------------------------------------
	function setConnected({ isConnected }) {
		statusEl.classList.toggle('connected', isConnected);
		statusEl.classList.toggle('disconnected', !isConnected);
	}

	// -------------------------------------------------------------------------
	// Resize handling: the fit is viewport-dependent, so re-run it whenever the
	// window changes size (projector resolution change, browser resize, rotation).
	// We debounce with requestAnimationFrame so a burst of resize events collapses
	// into a single fit per frame instead of thrashing layout.
	// -------------------------------------------------------------------------
	let resizeRaf = null;
	function onResize() {
		if (resizeRaf) cancelAnimationFrame(resizeRaf);
		resizeRaf = requestAnimationFrame(() => {
			resizeRaf = null;
			fitText();
		});
	}
	window.addEventListener('resize', onResize);

	// Apply TV-safe padding immediately so the overlays sit correctly even
	// before the first state push arrives from the server.
	tvSafeInnerSize();

	// Cursor visibility is a tweak flag, not a CSS hard-code, so flipping
	// SHOW_CURSOR and refreshing /present is the whole workflow.
	document.body.style.cursor = SHOW_CURSOR ? 'default' : 'none';
	document.documentElement.style.setProperty('--crossfade-ms', CROSSFADE_MS + 'ms');

	// Fonts can load/settle after first paint and change text metrics; when that
	// happens, refit so we don't end up slightly too big or too small. Guarded in
	// case the Font Loading API isn't available.
	if (document.fonts && typeof document.fonts.ready?.then === 'function') {
		document.fonts.ready.then(() => fitText());
	}

	// -------------------------------------------------------------------------
	// Boot: open the shared socket. onState re-renders on every push; onStatus
	// updates the connection dot. The socket auto-reconnects on its own.
	// -------------------------------------------------------------------------
	window.SlideSocket.connect({
		onState: (state) => render({ state }),
		onStatus: (isConnected) => setConnected({ isConnected }),
	});
})();
