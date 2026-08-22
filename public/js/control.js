// control.js
// -----------------------------------------------------------------------------
// The CONTROL window (editor + presenter remote) for QuickSlides.
//
// Responsibilities:
//   - Connect to the shared WebSocket (via window.SlideSocket) and react to full
//     authoritative state pushes from the server.
//   - Render the slide list (delegated to window.ControlList) and a live editor.
//   - Send navigation, edit, add, remove, and reorder messages using window.MSG.
//
// Architecture note: the SERVER is authoritative. We never mutate shared truth
// locally except as an *optimistic* preview (so previews/typing feel instant);
// every real change is a message to the server, which rebroadcasts full state
// that we then reconcile against.
//
// The trickiest UX concern here is "don't clobber the textarea while the operator
// is typing." See syncEditor() for the exact rule. In short: we only overwrite
// the textarea from server state when either (a) the selected slide changed, or
// (b) the textarea is not currently focused. While the operator is actively typing
// in the selected slide, incoming echoes of their own edit are ignored so their
// cursor never jumps.
//
// No frameworks, no bundler, no default exports (project rules). Own helper
// functions use named-parameter objects and never use the `arguments` object.
// -----------------------------------------------------------------------------

(function () {
	// -------------------------------------------------------------------------
	// Module-scoped state. Kept in a closure so nothing leaks to window.
	// -------------------------------------------------------------------------

	// The last full deck state received from the server. Treated as the source of
	// truth for rendering. We DO apply optimistic edits to slide.text locally so
	// previews update instantly, but structural changes only come from the server.
	let state = {
		currentIndex: 0,
		slides: [],
		blackout: false,
		backgroundOn: false,
		backgroundUrl: '',
		presenterViewport: null,
	};

	// Which slide the editor is currently editing. This is a real, independent
	// variable (not just "currentIndex") so the clobber-prevention logic has a
	// stable key to compare against. In normal use it tracks the current slide,
	// because selecting/navigating keeps them in sync.
	let selectedId = null;

	// The slide id whose text the <textarea> currently reflects. Compared against
	// selectedId on each state push to detect "the selected slide changed" (which
	// is one of the two conditions under which we are allowed to overwrite the
	// textarea). Distinct from selectedId so we know what the DOM actually shows.
	let editorSlideId = null;

	// One-shot flags used to reconcile asynchronous server responses:
	//  - followCurrentOnNextState: after a prev/next/goto we want the editor
	//    selection to follow whatever the server made current.
	//  - focusEditorOnNextState: after adding a slide (server makes it current)
	//    we want to select it AND focus the textarea for immediate typing.
	let followCurrentOnNextState = false;
	let focusEditorOnNextState = false;
	// After duplicate: select the copy that the server inserted after this id
	// (do NOT follow currentIndex — the projector must stay on the original).
	let selectDuplicateOfId = null;
	// After a list click/dblclick, onState must not center-scroll the row —
	// that slides the click target out from under the mouse.
	let skipNextCurrentScroll = false;

	// Debounced-edit bookkeeping. We coalesce keystrokes and send at most one
	// EDIT_SLIDE per ~150ms of typing. pendingEdit always holds the latest value.
	const EDIT_DEBOUNCE_MS = 150;
	let pendingEdit = null; // { id, text } or null
	let editTimer = null;

	// The shared socket api ({ lastState, send }). Assigned in init().
	let sock = null;

	// Cached DOM references (assigned in init()).
	let listEl = null; // <ul> that holds slide rows
	let editorEl = null; // <textarea> for the selected slide
	let editorMetaEl = null; // small label: "Editing slide 3 of 20"
	let statusDotEl = null; // connection indicator dot
	let statusTextEl = null; // connection indicator text
	let posEl = null; // footer "3 / 20" position readout
	let blackoutBtnEl = null; // header "Black" toggle
	let bgBtnEl = null; // header "BG" toggle
	let bgFileEl = null;
	let searchInputEl = null;
	let searchPopupEl = null;
	let searchCountEl = null;
	let searchPrevBtnEl = null;
	let searchNextBtnEl = null;

	// BM25 search state. matches is an ordered list of { id, index, score }.
	// Stepping through matches ONLY changes selectedId (editor + list highlight).
	// It never sends NAV — the projector stays put until Show on screen / Next / Prev.
	let searchMatches = [];
	let searchMatchIndex = 0;
	let searchTimer = null;
	const SEARCH_DEBOUNCE_MS = 80;

	// -------------------------------------------------------------------------
	// Small helpers
	// -------------------------------------------------------------------------

	// The id of the slide the presentation is currently showing, or null if empty.
	function currentSlideId() {
		const s = state.slides[state.currentIndex];
		return s ? s.id : null;
	}

	// The 0-based index of the selected slide, or -1 if none/not found. Used to
	// compute afterIndex for Add and to display "slide N of M".
	function selectedIndex() {
		return state.slides.findIndex((s) => s.id === selectedId);
	}

	// -------------------------------------------------------------------------
	// Debounced edit sending
	// -------------------------------------------------------------------------

	// Queue an edit to be sent after the debounce window. We always store the most
	// recent { id, text } so a burst of keystrokes collapses into one send.
	function scheduleEdit({ id, text }) {
		pendingEdit = { id, text };
		if (editTimer) clearTimeout(editTimer);
		editTimer = setTimeout(flushPendingEdit, EDIT_DEBOUNCE_MS);
	}

	// Send any queued edit immediately and clear the timer. Called by the debounce
	// timer, and eagerly whenever we're about to change selection / blur, so the
	// operator's last keystrokes are never lost when they move away from a slide.
	function flushPendingEdit() {
		if (editTimer) {
			clearTimeout(editTimer);
			editTimer = null;
		}
		if (pendingEdit) {
			sock.send({ type: window.MSG.EDIT_SLIDE, id: pendingEdit.id, text: pendingEdit.text });
			pendingEdit = null;
		}
	}

	// -------------------------------------------------------------------------
	// Rendering
	// -------------------------------------------------------------------------

	// Re-render the slide list from current state. Delegated to ControlList, which
	// preserves scroll position and uses textContent for safe previews.
	function renderList({ scrollCurrentIntoView, scrollSelectedIntoView } = {}) {
		const matchIds = searchMatches.length ? new Set(searchMatches.map((m) => m.id)) : null;
		window.ControlList.render({
			container: listEl,
			slides: state.slides,
			currentIndex: state.currentIndex,
			selectedId,
			matchIds,
			scrollCurrentIntoView,
			scrollSelectedIntoView,
			handlers: {
				onSelect: handleSelect,
				onShow: handleShowFromList,
				onDelete: handleDelete,
				onMoveUp: handleMoveUp,
				onMoveDown: handleMoveDown,
				onDropReorder: handleDropReorder,
			},
		});
	}

	// Reconcile the <textarea> with the selected slide's text WITHOUT clobbering an
	// active edit. This is the heart of the live-editing UX.
	//
	// Rule: overwrite the textarea value from server state ONLY when either
	//   (a) the selected slide changed since the textarea was last populated
	//       (editorSlideId !== selectedId), OR
	//   (b) the textarea is not currently focused.
	// If the operator is focused and still on the same slide, we leave the textarea
	// exactly as-is. That means echoes of their own in-flight edits (rebroadcast by
	// the server) never move their cursor. The trade-off: a *remote* edit to the
	// same slide while you are typing it is not shown until you blur — acceptable
	// for a single-operator console, and far better than a jumping cursor.
	function syncEditor({ forceFocus }) {
		const slide = state.slides.find((s) => s.id === selectedId);
		const hasSlide = Boolean(slide);

		// Disable the editor when there is nothing to edit (empty deck).
		editorEl.disabled = !hasSlide;

		const text = hasSlide ? slide.text : '';
		const selectionChanged = selectedId !== editorSlideId;
		const isFocused = document.activeElement === editorEl;

		if (selectionChanged || !isFocused) {
			// Safe to (re)populate: either we switched slides, or the user isn't in
			// the box, so we won't fight their cursor.
			editorEl.value = text;
			editorSlideId = selectedId;
		}

		// Update the "Editing slide N of M" label.
		if (hasSlide) {
			const n = selectedIndex() + 1;
			editorMetaEl.textContent = `Editing slide ${n} of ${state.slides.length}`;
		} else {
			editorMetaEl.textContent = 'No slide selected';
		}

		// After an Add, jump focus into the textarea and put the caret at the end so
		// the operator can start typing the new slide immediately.
		if (forceFocus && hasSlide) {
			editorEl.focus();
			const end = editorEl.value.length;
			editorEl.setSelectionRange(end, end);
		}

		// Projector-faithful preview of whatever the editor currently shows
		// (textarea if focused/populated, else the selected slide's text).
		updatePreview();
	}

	function updatePreview() {
		if (!window.ControlPreview) return;
		const live = editorEl && !editorEl.disabled ? editorEl.value : '';
		window.ControlPreview.paint({
			text: live,
			live: Boolean(selectedId) && selectedId === currentSlideId(),
		});
	}

	// Update the footer position readout ("3 / 20") and Prev/Next disabled states.
	function renderNav() {
		const total = state.slides.length;
		if (total === 0) {
			posEl.textContent = '0 / 0';
		} else {
			posEl.textContent = `${state.currentIndex + 1} / ${total}`;
		}
	}

	// Keep the header Black button in sync with server-authoritative blackout.
	// `is-on` + aria-pressed so the operator can see the projector is blacked
	// without looking at the second screen.
	function renderBlackout() {
		if (!blackoutBtnEl) return;
		const on = state.blackout === true;
		blackoutBtnEl.classList.toggle('is-on', on);
		blackoutBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
		blackoutBtnEl.textContent = on ? 'Black ON' : 'Black';
	}

	// Toggle projector blackout. Server flips the flag and broadcasts; both
	// windows update from that state. Does not change currentIndex.
	function handleBlackout() {
		sock.send({ type: window.MSG.BLACKOUT });
	}

	function renderBackground() {
		if (!bgBtnEl) return;
		const on = state.backgroundOn === true;
		bgBtnEl.classList.toggle('is-on', on);
		bgBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
		bgBtnEl.textContent = on ? 'BG ON' : 'BG';
		if (window.ControlPreview && typeof window.ControlPreview.setBackground === 'function') {
			window.ControlPreview.setBackground({
				on,
				url: state.backgroundUrl || '',
			});
		}
	}

	function handleBackground() {
		sock.send({ type: window.MSG.BACKGROUND });
	}

	async function handleBackgroundFile({ file }) {
		if (!file) return;
		try {
			await fetch('/api/background', {
				method: 'POST',
				headers: { 'Content-Type': file.type || 'image/jpeg' },
				body: file,
			});
		} catch (err) {
			console.error('[bg] upload failed', err);
		}
	}

	// -------------------------------------------------------------------------
	// BM25 slide search — select-only, never drives the projector
	// -------------------------------------------------------------------------

	// Select a slide for editing / list highlight WITHOUT sending NAV. This is
	// the only path search uses. handleSelect (list click) still does goto.
	function selectForEditOnly({ id, scroll }) {
		if (!id) return;
		flushPendingEdit();
		selectedId = id;
		// Search arrows pass scroll:true. List clicks must NOT scroll — centering
		// the row would yank it out from under the cursor.
		renderList({ scrollSelectedIntoView: scroll === true });
		syncEditor({ forceFocus: false });
	}

	function renderSearchPopup() {
		if (!searchPopupEl || !searchCountEl) return;
		const query = searchInputEl ? searchInputEl.value.trim() : '';
		if (!query) {
			searchPopupEl.hidden = true;
			return;
		}
		searchPopupEl.hidden = false;
		const total = searchMatches.length;
		if (total === 0) {
			searchCountEl.textContent = '0 matches';
			searchPrevBtnEl.disabled = true;
			searchNextBtnEl.disabled = true;
			return;
		}
		searchCountEl.textContent = `${searchMatchIndex + 1}/${total} matches`;
		searchPrevBtnEl.disabled = false;
		searchNextBtnEl.disabled = false;
	}

	// Re-run BM25 against the current query. jumpToFirst is true while typing
	// so the editor lands on the best hit; false on deck-state refreshes so
	// we don't yank the operator off a match they already stepped to.
	function refreshSearch({ jumpToFirst }) {
		const query = searchInputEl ? searchInputEl.value : '';
		if (!query.trim()) {
			searchMatches = [];
			searchMatchIndex = 0;
			renderSearchPopup();
			return;
		}
		searchMatches = window.Bm25.rankSlides({ slides: state.slides, query });
		if (jumpToFirst) {
			searchMatchIndex = 0;
			if (searchMatches[0]) selectForEditOnly({ id: searchMatches[0].id, scroll: true });
		} else if (searchMatches.length) {
			const keep = searchMatches.findIndex((m) => m.id === selectedId);
			searchMatchIndex = keep >= 0 ? keep : 0;
		} else {
			searchMatchIndex = 0;
		}
		renderSearchPopup();
		// Repaint match highlighting without forcing a scroll (onState already
		// scrolled if currentIndex moved). Skip if jumpToFirst already rendered.
		if (!jumpToFirst) renderList();
	}

	function cycleSearchMatch({ delta }) {
		if (searchMatches.length === 0) return;
		searchMatchIndex = (searchMatchIndex + delta + searchMatches.length) % searchMatches.length;
		selectForEditOnly({ id: searchMatches[searchMatchIndex].id, scroll: true });
		renderSearchPopup();
	}

	// Explicit close on the 1/X bar: wipe the query, hide the chip, drop
	// match highlighting. Does not change the projector or the selected slide.
	function clearSearch() {
		if (searchTimer) {
			clearTimeout(searchTimer);
			searchTimer = null;
		}
		if (searchInputEl) searchInputEl.value = '';
		searchMatches = [];
		searchMatchIndex = 0;
		renderSearchPopup();
		renderList({ scrollCurrentIntoView: true });
	}

	function handleSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			refreshSearch({ jumpToFirst: true });
			// Empty query: clear match wash on the list.
			if (!searchInputEl.value.trim()) renderList({ scrollCurrentIntoView: true });
		}, SEARCH_DEBOUNCE_MS);
	}

	// Left/right inside the search box cycle matches. They must NOT fall
	// through to presentation Next/Prev (handleKeyDown already ignores INPUT,
	// but we still preventDefault so the caret doesn't wander).
	function handleSearchKeyDown(event) {
		// ArrowUp / ArrowDown (and Left / Right) step the 1/X match list —
		// same as the popup buttons. Check both key and code so we don't miss
		// a layout that reports one but not the other. preventDefault so the
		// caret doesn't move and so nothing bubbles to presentation Next/Prev.
		const code = event.code || '';
		const key = event.key || '';
		const goNextMatch =
			key === 'ArrowDown' || key === 'ArrowRight' || code === 'ArrowDown' || code === 'ArrowRight';
		const goPrevMatch =
			key === 'ArrowUp' || key === 'ArrowLeft' || code === 'ArrowUp' || code === 'ArrowLeft';
		if (goNextMatch) {
			event.preventDefault();
			event.stopPropagation();
			cycleSearchMatch({ delta: 1 });
		} else if (goPrevMatch) {
			event.preventDefault();
			event.stopPropagation();
			cycleSearchMatch({ delta: -1 });
		} else if (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter') {
			// Put the selected match on the projector — same as "Show on screen".
			event.preventDefault();
			event.stopPropagation();
			showSelectedOnScreen();
		}
	}

	// -------------------------------------------------------------------------
	// Server state reconciliation
	// -------------------------------------------------------------------------

	// Called by the socket on EVERY full-state push. This is where we resolve the
	// selection against one-shot flags and re-render everything.
	function onState(nextState) {
		// Capture the previous pointer BEFORE we overwrite state so we know
		// whether Next/Prev/goto actually moved the live slide (and thus
		// whether the left list should scroll that row into view).
		const prevCurrentIndex = state.currentIndex;

		// Defensive normalization so a malformed frame can't throw during render.
		state = {
			currentIndex: Number.isInteger(nextState.currentIndex) ? nextState.currentIndex : 0,
			slides: Array.isArray(nextState.slides) ? nextState.slides : [],
			blackout: nextState.blackout === true,
			backgroundOn: nextState.backgroundOn === true,
			backgroundUrl: typeof nextState.backgroundUrl === 'string' ? nextState.backgroundUrl : '',
			presenterViewport: nextState.presenterViewport || null,
		};

		// Live projector size → preview aspect ratio (no Control reload).
		if (
			window.ControlPreview &&
			typeof window.ControlPreview.setViewport === 'function' &&
			state.presenterViewport
		) {
			window.ControlPreview.setViewport({
				width: state.presenterViewport.width,
				height: state.presenterViewport.height,
			});
		}

		// Resolve which slide should be selected/edited after this update:
		//  - After duplicate: select the copy inserted after the source id.
		//    Must run BEFORE the follow-current path so we don't steal the
		//    projector's current slide into the editor.
		//  - After add: select the (now current) new slide and focus it.
		//  - After prev/next/goto: follow the server's current slide.
		if (selectDuplicateOfId) {
			const sourceIdx = state.slides.findIndex((s) => s.id === selectDuplicateOfId);
			if (sourceIdx !== -1 && state.slides[sourceIdx + 1]) {
				selectedId = state.slides[sourceIdx + 1].id;
			}
		} else if (focusEditorOnNextState || followCurrentOnNextState) {
			selectedId = currentSlideId();
		}

		// If the selected slide no longer exists (e.g. it was deleted), fall back to
		// whatever the server now considers current so the editor always has a target.
		const stillExists = state.slides.some((s) => s.id === selectedId);
		if (!stillExists) {
			selectedId = currentSlideId();
		}

		// Render list first, then reconcile the editor, then the footer nav
		// and the blackout button's on/off appearance. Scroll the live slide
		// into view only when currentIndex actually changed — not on every
		// keystroke preview re-render, which would yank the list around.
		renderList({
			scrollCurrentIntoView: !skipNextCurrentScroll && state.currentIndex !== prevCurrentIndex,
		});
		skipNextCurrentScroll = false;
		syncEditor({ forceFocus: focusEditorOnNextState });
		renderNav();
		renderBlackout();
		renderBackground();
		// Re-score the open search against the new deck (edits/add/remove) but
		// do not jump to the first hit — keep the operator where they were.
		refreshSearch({ jumpToFirst: false });

		// Consume one-shot flags.
		followCurrentOnNextState = false;
		focusEditorOnNextState = false;
		selectDuplicateOfId = null;
	}

	// Connection indicator, driven by the socket's onStatus callback.
	function onStatus(isConnected) {
		if (isConnected) {
			statusDotEl.classList.add('online');
			statusDotEl.classList.remove('offline');
			statusTextEl.textContent = 'Connected';
		} else {
			statusDotEl.classList.add('offline');
			statusDotEl.classList.remove('online');
			statusTextEl.textContent = 'Reconnecting…';
		}
	}

	// -------------------------------------------------------------------------
	// User action handlers (wired to buttons, keys, and list callbacks)
	// -------------------------------------------------------------------------

	// Advance the presentation. We flush pending edits first so nothing is lost,
	// then ask the editor selection to follow the new current slide.
	function goNext() {
		flushPendingEdit();
		followCurrentOnNextState = true;
		sock.send({ type: window.MSG.NAV, action: 'next' });
	}

	function goPrev() {
		flushPendingEdit();
		followCurrentOnNextState = true;
		sock.send({ type: window.MSG.NAV, action: 'prev' });
	}

	// Single-click a list row: select it for editing ONLY. The projector does
	// not change. Show-on-screen is reserved for the button, a double-click,
	// or the footer Prev/Next controls.
	function handleSelect({ id }) {
		selectForEditOnly({ id });
	}

	// Double-click a list row: select it and put it on the projector.
	function handleShowFromList({ id, index }) {
		flushPendingEdit();
		selectedId = id;
		followCurrentOnNextState = true;
		skipNextCurrentScroll = true;
		renderList();
		syncEditor({ forceFocus: false });
		sock.send({ type: window.MSG.NAV, action: 'goto', index });
	}

	// Explicit "Show on screen" for the currently selected slide.
	function showSelectedOnScreen() {
		const index = selectedIndex();
		if (index < 0) return;
		followCurrentOnNextState = true;
		sock.send({ type: window.MSG.NAV, action: 'goto', index });
	}

	// Add a blank slide AFTER the currently selected slide. The server makes the
	// new slide current; we set focusEditorOnNextState so onState selects+focuses it.
	function handleAdd() {
		flushPendingEdit();
		// afterIndex is the selected slide's index; -1 (no selection) inserts at start.
		const afterIndex = selectedIndex(); // -1 when nothing is selected/empty deck
		focusEditorOnNextState = true;
		sock.send({ type: window.MSG.ADD_SLIDE, afterIndex });
	}

	// Copy the selected slide and insert the copy immediately after it.
	// Projector stays on whatever was showing (server does not change
	// currentIndex). Editor jumps to the copy so you can tweak it.
	function handleDuplicate() {
		if (!selectedId) return;
		flushPendingEdit();
		selectDuplicateOfId = selectedId;
		focusEditorOnNextState = true;
		sock.send({ type: window.MSG.DUPLICATE_SLIDE, id: selectedId });
	}

	// Delete a slide by id, with a confirmation guard so a stray click can't nuke
	// content mid-service.
	function handleDelete({ id, index }) {
		const human = typeof index === 'number' ? index + 1 : '?';
		const ok = window.confirm(`Delete slide ${human}? This cannot be undone.`);
		if (!ok) return;
		flushPendingEdit();
		sock.send({ type: window.MSG.REMOVE_SLIDE, id });
	}

	// Delete whatever slide is currently selected (editor-panel affordance).
	function handleDeleteSelected() {
		if (!selectedId) return;
		handleDelete({ id: selectedId, index: selectedIndex() });
	}

	// Move a slide up/down by swapping it with its neighbor and sending the full
	// resulting id order. The server keeps the same slide "current" by id, so the
	// presentation pointer stays on the right content; we follow it in the editor.
	function handleMoveUp({ index }) {
		if (index <= 0) return;
		const orderedIds = state.slides.map((s) => s.id);
		const tmp = orderedIds[index - 1];
		orderedIds[index - 1] = orderedIds[index];
		orderedIds[index] = tmp;
		followCurrentOnNextState = true;
		sock.send({ type: window.MSG.REORDER, orderedIds });
	}

	function handleMoveDown({ index }) {
		if (index >= state.slides.length - 1) return;
		const orderedIds = state.slides.map((s) => s.id);
		const tmp = orderedIds[index + 1];
		orderedIds[index + 1] = orderedIds[index];
		orderedIds[index] = tmp;
		followCurrentOnNextState = true;
		sock.send({ type: window.MSG.REORDER, orderedIds });
	}

	// Drag-and-drop reorder: remove the dragged id from the order and re-insert it
	// at the drop target's position, then send the full new order.
	function handleDropReorder({ fromId, toIndex }) {
		const orderedIds = state.slides.map((s) => s.id);
		const fromIndex = orderedIds.indexOf(fromId);
		if (fromIndex === -1) return;
		// Remove the dragged id, then splice it in at the target slot.
		orderedIds.splice(fromIndex, 1);
		// toIndex refers to a position in the ORIGINAL array; after removal, if the
		// source was before the target, the target shifts left by one. Clamp to keep
		// it in range regardless.
		let insertAt = toIndex;
		if (fromIndex < toIndex) insertAt = toIndex - 1;
		if (insertAt < 0) insertAt = 0;
		if (insertAt > orderedIds.length) insertAt = orderedIds.length;
		orderedIds.splice(insertAt, 0, fromId);
		followCurrentOnNextState = true;
		sock.send({ type: window.MSG.REORDER, orderedIds });
	}

	// -------------------------------------------------------------------------
	// Editor (textarea) wiring
	// -------------------------------------------------------------------------

	function handleEditorInput() {
		const id = selectedId;
		if (!id) return;
		const text = editorEl.value;

		// Optimistically apply to local state so the list preview reflects typing
		// immediately (the list re-render below won't touch the focused textarea).
		const slide = state.slides.find((s) => s.id === id);
		if (slide) slide.text = text;

		// The textarea now reflects this slide's edited text; record that so a
		// same-slide server echo won't be treated as a "selection changed" overwrite.
		editorSlideId = id;

		// Debounced send to the server, and a lightweight list repaint for previews.
		scheduleEdit({ id, text });
		renderList();
		updatePreview();
	}

	// Flush on blur so leaving the field (Tab, clicking elsewhere) sends promptly.
	function handleEditorBlur() {
		flushPendingEdit();
	}

	// -------------------------------------------------------------------------
	// Global keyboard navigation
	// -------------------------------------------------------------------------

	// ArrowRight / Space / PageDown => next; ArrowLeft / PageUp => prev.
	// Crucially, we IGNORE these keys while the operator is typing in the editor
	// textarea or any input/contenteditable, so navigation never eats keystrokes.
	function handleKeyDown(event) {
		const target = event.target;
		const tag = target && target.tagName;
		const isTyping =
			tag === 'TEXTAREA' ||
			tag === 'INPUT' ||
			tag === 'SELECT' ||
			(target && target.isContentEditable === true);
		if (isTyping) return;

		// Ignore combos with modifiers so we don't clash with browser shortcuts.
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const key = event.key;
		if (key === 'ArrowRight' || key === ' ' || key === 'Spacebar' || key === 'PageDown') {
			event.preventDefault();
			goNext();
		} else if (key === 'ArrowLeft' || key === 'PageUp') {
			event.preventDefault();
			goPrev();
		}
	}

	// -------------------------------------------------------------------------
	// Bootstrap
	// -------------------------------------------------------------------------

	function init() {
		// Grab DOM handles once.
		listEl = document.getElementById('slide-list');
		editorEl = document.getElementById('editor');
		editorMetaEl = document.getElementById('editor-meta');
		statusDotEl = document.getElementById('status-dot');
		statusTextEl = document.getElementById('status-text');
		posEl = document.getElementById('nav-position');
		blackoutBtnEl = document.getElementById('btn-blackout');
		bgBtnEl = document.getElementById('btn-bg');
		bgFileEl = document.getElementById('bg-file');
		searchInputEl = document.getElementById('slide-search');
		searchPopupEl = document.getElementById('search-popup');
		searchCountEl = document.getElementById('search-count');
		searchPrevBtnEl = document.getElementById('search-prev');
		searchNextBtnEl = document.getElementById('search-next');

		// Wire buttons.
		document.getElementById('btn-prev').addEventListener('click', goPrev);
		document.getElementById('btn-next').addEventListener('click', goNext);
		document.getElementById('btn-add').addEventListener('click', handleAdd);
		document.getElementById('btn-delete-selected').addEventListener('click', handleDeleteSelected);
		document.getElementById('btn-show').addEventListener('click', showSelectedOnScreen);
		document.getElementById('btn-duplicate').addEventListener('click', handleDuplicate);
		blackoutBtnEl.addEventListener('click', handleBlackout);
		bgBtnEl.addEventListener('click', handleBackground);
		document.getElementById('btn-bg-load').addEventListener('click', () => bgFileEl.click());
		bgFileEl.addEventListener('change', () => {
			const file = bgFileEl.files && bgFileEl.files[0];
			handleBackgroundFile({ file });
			bgFileEl.value = '';
		});
		searchInputEl.addEventListener('input', handleSearchInput);
		searchInputEl.addEventListener('keydown', handleSearchKeyDown);
		searchPrevBtnEl.addEventListener('click', () => cycleSearchMatch({ delta: -1 }));
		searchNextBtnEl.addEventListener('click', () => cycleSearchMatch({ delta: 1 }));
		document.getElementById('search-close').addEventListener('click', clearSearch);

		// Wire the editor.
		editorEl.addEventListener('input', handleEditorInput);
		editorEl.addEventListener('blur', handleEditorBlur);

		// Global keyboard navigation.
		document.addEventListener('keydown', handleKeyDown);

		window.ControlPreview.bind({
			frame: document.getElementById('preview-frame'),
			stage: document.getElementById('preview-stage'),
			slide: document.getElementById('preview-slide'),
		});

		function pushDisplaySettings({ settings }) {
			if (window.SlideFit && typeof window.SlideFit.configure === 'function') {
				window.SlideFit.configure({ settings });
			}
			updatePreview();
			if (sock) {
				sock.send({ type: window.MSG.DISPLAY_SETTINGS, settings });
			}
		}

		const settingsApi = window.ControlSettings.bind({
			onChange: pushDisplaySettings,
		});
		// Apply stored knobs to the control preview before the socket is up.
		pushDisplaySettings({ settings: settingsApi.getSettings() });

		// Open the socket. onState/onStatus drive all rendering from here on.
		// onOpen re-pushes localStorage settings so a server restart picks them
		// up without the operator reopening Settings.
		sock = window.SlideSocket.connect({
			onState,
			onStatus,
			onOpen: () => {
				pushDisplaySettings({ settings: settingsApi.getSettings() });
				// Ask /present to send innerWidth/innerHeight now — do not wait
				// for the operator to resize the projector window.
				sock.send({ type: window.MSG.REQUEST_VIEWPORT });
			},
		});
	}

	// The scripts are loaded at the end of <body>, but guard for safety in case the
	// load order ever changes.
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
