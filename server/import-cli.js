// import-cli.js
// -----------------------------------------------------------------------------
// Command-line entry point for importing a PowerPoint .pptx into this app's deck.
//
// Usage:
//     node server/import-cli.js [/absolute/path/to/file.pptx]
//
// If no path is given it defaults to the known Worship Set file in Downloads.
// The parsed slides replace the entire on-disk deck (data/deck.json) via the
// existing state module, so after running this the app will present the imported
// slides immediately on next load.
// -----------------------------------------------------------------------------

const { importPptx } = require('./pptx-import');
const state = require('./state');

// Default source file. Overridable as argv[2] for importing any other deck.
const DEFAULT_PPTX = '/Users/josiahbryan/Downloads/Worship Set - Slides Final.pptx';

async function main() {
	const filePath = process.argv[2] || DEFAULT_PPTX;
	console.log(`[import] Reading PPTX: ${filePath}`);

	// Parse the .pptx into ordered, text-only slides.
	const { slides } = await importPptx({ filePath });

	// Persist: replace the whole deck, then force an immediate write. We call
	// saveNow() explicitly because replaceDeck() only *schedules* a debounced
	// write, and this short-lived CLI process would exit before that timer fires.
	state.replaceDeck({ slides });
	state.saveNow();

	// --- Summary / verification output -------------------------------------
	const total = slides.length;
	const nonEmpty = slides.filter((s) => s.text.trim() !== '');
	const nonEmptyCount = nonEmpty.length;

	console.log(`[import] Wrote deck to: ${state.DECK_FILE}`);
	console.log(`[import] Total slides:      ${total}`);
	console.log(`[import] Non-empty slides:  ${nonEmptyCount}`);
	console.log(`[import] Empty slides:      ${total - nonEmptyCount}`);

	// Print the first 3 non-empty slides so the operator can eyeball ordering
	// and content correctness right from the terminal.
	console.log('[import] First 3 non-empty slides:');
	nonEmpty.slice(0, 3).forEach((slide, i) => {
		console.log(`  --- non-empty slide #${i + 1} (id ${slide.id}) ---`);
		slide.text.split('\n').forEach((line) => console.log(`    ${line}`));
	});
}

main().catch((err) => {
	console.error('[import] FAILED:', err.message);
	process.exit(1);
});
