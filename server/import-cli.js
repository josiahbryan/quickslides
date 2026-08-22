// import-cli.js
// -----------------------------------------------------------------------------
// Command-line entry point for importing a PowerPoint .pptx into this app's deck.
//
// Usage:
//     node server/import-cli.js [/absolute/path/to/file.pptx]
//
// Path is argv[2], or QUICKSLIDES_PPTX, or a Downloads file if it exists
// on this machine (see server/import-path.js).
// The parsed slides replace the entire on-disk deck (data/deck.json) via the
// existing state module, so after running this the app will present the imported
// slides immediately on next load.
// -----------------------------------------------------------------------------

const { importPptx } = require('./pptx-import');
const state = require('./state');
const { resolvePptxPath } = require('./import-path');

async function main() {
	const filePath = resolvePptxPath({
		argvPath: process.argv[2],
		envPath: process.env.QUICKSLIDES_PPTX,
	});
	if (!filePath) {
		console.error('Usage: node server/import-cli.js <path-to.pptx>');
		console.error('   or: QUICKSLIDES_PPTX=/path/to/deck.pptx npm run import');
		process.exit(1);
	}
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

// Only run the CLI when this file is the entry point. Tests require() the
// path-resolution helper without importing a real .pptx.
if (require.main === module) {
	main().catch((err) => {
		console.error('[import] FAILED:', err.message);
		process.exit(1);
	});
}

module.exports = { resolvePptxPath };
