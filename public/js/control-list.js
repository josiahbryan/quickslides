// control-list.js
// -----------------------------------------------------------------------------
// Renders the left-hand SLIDE LIST for the control window. Kept in its own file
// so control.js stays focused on socket/editor/navigation logic (the project
// prefers small, single-responsibility modules).
//
// This module is intentionally "dumb": it takes the current deck data plus a set
// of callbacks and (re)builds the list DOM. All application decisions (what to do
// when an item is clicked, deleted, moved, or dropped) live in control.js and are
// passed in via the `handlers` object. That separation keeps rendering pure and
// side-effect free apart from touching the container it is given.
//
// Exposed as a global (window.ControlList) because the page loads plain <script>
// tags with no bundler. No default exports (project rule).
// -----------------------------------------------------------------------------

window.ControlList = (function () {
	// Full slide body for the list row. Newlines are kept (CSS pre-wrap shows
	// them as multiple lines). Blank slides get a labeled placeholder.
	// Assigned via textContent so no HTML injection is possible.
	function previewText({ text }) {
		const body = String(text || '');
		return body.trim().length > 0 ? body : '(blank)';
	}

	// Build one <li> row for a single slide. Broken out so render() stays readable.
	// `index` is the 0-based position; we display index + 1 to the operator.
	function buildItem({ slide, index, total, currentIndex, selectedId, matchIds, handlers }) {
		const li = document.createElement('li');
		li.className = 'slide-item';
		li.dataset.id = slide.id;
		li.dataset.index = String(index);

		// HTML5 drag-and-drop reordering. Move Up/Down buttons (below) are the
		// robust fallback; dragging is the "nice" path. Both end up calling the
		// same reorder handler with a full ordered id array.
		li.draggable = true;

		// Visual state: highlight the slide currently shown on the PRESENTATION
		// (currentIndex) and the slide being EDITED (selectedId). These are usually
		// the same slide, but we style them independently so the operator can always
		// tell what is live on screen.
		if (index === currentIndex) li.classList.add('is-current');
		if (slide.id === selectedId) li.classList.add('is-selected');
		if (matchIds && matchIds.has(slide.id)) li.classList.add('is-match');
		// Empty body: still a real, clickable row. We only mark it so CSS can
		// show "(blank)" as a dim placeholder — not the 0.3-opacity disabled look.
		const isBlank = String(slide.text || '').trim().length === 0;
		if (isBlank) li.classList.add('is-blank');

		// --- Left: 1-based index badge ---
		const badge = document.createElement('span');
		badge.className = 'slide-index';
		badge.textContent = String(index + 1);
		li.appendChild(badge);

		// --- Middle: the text preview (escaped via textContent) ---
		const preview = document.createElement('span');
		preview.className = 'slide-preview' + (isBlank ? ' is-placeholder' : '');
		preview.textContent = previewText({ text: slide.text });
		li.appendChild(preview);

		// --- Right: per-row actions (move up / move down / delete) ---
		const actions = document.createElement('span');
		actions.className = 'slide-actions';

		// Move Up: disabled on the first row (nothing above it).
		const upBtn = document.createElement('button');
		upBtn.type = 'button';
		upBtn.className = 'icon-btn';
		upBtn.title = 'Move up';
		upBtn.textContent = '↑';
		upBtn.disabled = index === 0;
		upBtn.addEventListener('click', (event) => {
			// Stop the click from bubbling to the row (which would select/navigate).
			event.stopPropagation();
			handlers.onMoveUp({ index });
		});
		actions.appendChild(upBtn);

		// Move Down: disabled on the last row (nothing below it).
		const downBtn = document.createElement('button');
		downBtn.type = 'button';
		downBtn.className = 'icon-btn';
		downBtn.title = 'Move down';
		downBtn.textContent = '↓';
		downBtn.disabled = index === total - 1;
		downBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			handlers.onMoveDown({ index });
		});
		actions.appendChild(downBtn);

		// Delete: removes this slide (control.js confirms before sending).
		const delBtn = document.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'icon-btn danger';
		delBtn.title = 'Delete slide';
		delBtn.textContent = '✕';
		delBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			handlers.onDelete({ id: slide.id, index });
		});
		actions.appendChild(delBtn);

		li.appendChild(actions);

		// Single-click: select for editing only (does NOT change the projector).
		// Double-click: put this slide on screen (same as "Show on screen").
		li.addEventListener('click', () => {
			handlers.onSelect({ id: slide.id, index });
		});
		li.addEventListener('dblclick', () => {
			handlers.onShow({ id: slide.id, index });
		});

		// --- Drag-and-drop wiring ---
		// On dragstart we stash the dragged slide's id. On dragover we allow the
		// drop and paint a visual insertion hint. On drop we hand the source id and
		// target index back to control.js, which computes the new full order.
		li.addEventListener('dragstart', (event) => {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', slide.id);
			li.classList.add('dragging');
		});
		li.addEventListener('dragend', () => {
			li.classList.remove('dragging');
		});
		li.addEventListener('dragover', (event) => {
			// Must preventDefault to signal this is a valid drop target.
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			li.classList.add('drop-target');
		});
		li.addEventListener('dragleave', () => {
			li.classList.remove('drop-target');
		});
		li.addEventListener('drop', (event) => {
			event.preventDefault();
			li.classList.remove('drop-target');
			const fromId = event.dataTransfer.getData('text/plain');
			if (fromId && fromId !== slide.id) {
				handlers.onDropReorder({ fromId, toIndex: index });
			}
		});

		return li;
	}

	// Full (re)render of the slide list. We rebuild the whole <ul> every time state
	// arrives. The deck is small, so a full rebuild is simpler and less bug-prone
	// than manual diffing — and it can never drift out of sync with server state.
	// We carefully preserve the container's scroll position across the rebuild so
	// the operator's view doesn't jump while they work.
	function render({
		container,
		slides,
		currentIndex,
		selectedId,
		handlers,
		scrollCurrentIntoView,
		scrollSelectedIntoView,
		matchIds,
	}) {
		// Preserve scroll so a re-render (e.g. on every keystroke's preview update)
		// doesn't yank the list back to the top.
		const previousScrollTop = container.scrollTop;

		// Clear existing rows. textContent = '' is the fastest safe way to empty it.
		container.textContent = '';

		if (!slides || slides.length === 0) {
			// Friendly empty-state so a fresh/empty deck doesn't look broken.
			const empty = document.createElement('li');
			empty.className = 'slide-empty';
			empty.textContent = 'No slides yet. Click "Add slide" to begin.';
			container.appendChild(empty);
			return;
		}

		const total = slides.length;
		slides.forEach((slide, index) => {
			const li = buildItem({
				slide,
				index,
				total,
				currentIndex,
				selectedId,
				matchIds,
				handlers,
			});
			container.appendChild(li);
		});

		// Restore scroll position after the DOM has been replaced. Then, if the
		// operator just advanced (Next/Prev/goto), bring the live slide into
		// view. `block: 'nearest'` only moves the list if the current row is
		// actually off-screen, so we don't jitter when it's already visible.
		container.scrollTop = previousScrollTop;
		// Prefer scrolling the *selected* row when search is stepping through
		// matches (that slide is NOT on the projector). Otherwise scroll the
		// live/current row after Next/Prev.
		const scrollSelector = scrollSelectedIntoView
			? '.slide-item.is-selected'
			: scrollCurrentIntoView
				? '.slide-item.is-current'
				: null;
		if (scrollSelector) {
			const row = container.querySelector(scrollSelector);
			if (row && typeof row.scrollIntoView === 'function') {
				row.scrollIntoView({ block: 'center', inline: 'nearest' });
			}
		}
	}

	return { render, previewText };
})();
