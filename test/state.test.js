// Deck mutation tests. QUICKSLIDES_DATA_DIR is pointed at a temp folder
// *before* we require state.js so we never write the operator's real
// data/deck.json (that file is often a copyrighted set list).
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-state-'));
process.env.QUICKSLIDES_DATA_DIR = tmpDir;

const state = require('../server/state');

function seed({ slides, currentIndex = 0 }) {
	state.replaceDeck({ slides });
	// replaceDeck always resets currentIndex to 0; tests that need another
	// pointer walk there with navigate after seeding.
	if (currentIndex > 0) {
		state.navigate({ action: 'goto', index: currentIndex });
	}
	return state.getDeck();
}

describe('state mutations', () => {
	before(() => {
		console.log('QUICKSLIDES_DATA_DIR', tmpDir);
		assert.notEqual(
			path.resolve(tmpDir),
			path.resolve(__dirname, '..', 'data'),
			'tests must not use the real data/ directory'
		);
	});

	beforeEach(() => {
		seed({
			slides: [
				{ id: 's1', text: 'one' },
				{ id: 's2', text: 'two' },
				{ id: 's3', text: 'three' },
			],
		});
	});

	after(() => {
		state.saveNow();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('navigate next/prev/goto clamps to the last slide', () => {
		state.navigate({ action: 'next' });
		assert.equal(state.getDeck().currentIndex, 1);
		state.navigate({ action: 'goto', index: 99 });
		const afterGoto = state.getDeck().currentIndex;
		console.log('goto 99 clamped to', afterGoto);
		assert.equal(afterGoto, 2);
		state.navigate({ action: 'next' });
		assert.equal(state.getDeck().currentIndex, 2, 'next at end stays at end');
		state.navigate({ action: 'prev' });
		assert.equal(state.getDeck().currentIndex, 1);
	});

	it('editSlide changes only that slide body', () => {
		state.editSlide({ id: 's2', text: 'TWO\nlines' });
		const deck = state.getDeck();
		console.log(
			'texts after edit:',
			deck.slides.map((s) => s.text)
		);
		assert.equal(deck.slides[1].text, 'TWO\nlines');
		assert.equal(deck.slides[0].text, 'one');
	});

	it('addSlide after index 0 inserts and makes the new slide current', () => {
		const beforeLen = state.getDeck().slides.length;
		state.addSlide({ afterIndex: 0 });
		const deck = state.getDeck();
		console.log('add after 0: index', deck.currentIndex, 'len', deck.slides.length);
		assert.equal(deck.slides.length, beforeLen + 1);
		assert.equal(deck.currentIndex, 1);
		assert.equal(deck.slides[1].text, '');
		assert.notEqual(deck.slides[1].id, 's1');
	});

	it('duplicateSlide copies text after the original and does not move the projector when current is the original', () => {
		state.navigate({ action: 'goto', index: 1 });
		assert.equal(state.getDeck().currentIndex, 1);
		state.duplicateSlide({ id: 's2' });
		const deck = state.getDeck();
		console.log(
			'duplicate s2: index',
			deck.currentIndex,
			'ids',
			deck.slides.map((s) => s.id),
			'texts',
			deck.slides.map((s) => s.text)
		);
		assert.equal(deck.currentIndex, 1, 'projector stays on s2');
		assert.equal(deck.slides[2].text, 'two');
		assert.notEqual(deck.slides[2].id, 's2');
		assert.equal(deck.slides.length, 4);
	});

	it('duplicateSlide before the current slide bumps currentIndex so the same lyrics stay up', () => {
		state.navigate({ action: 'goto', index: 2 });
		state.duplicateSlide({ id: 's1' });
		const deck = state.getDeck();
		console.log(
			'dup before current: index',
			deck.currentIndex,
			'id',
			deck.slides[deck.currentIndex].id
		);
		assert.equal(deck.currentIndex, 3);
		assert.equal(deck.slides[3].id, 's3');
	});

	it('removeSlide before current shifts the pointer so the same slide stays up', () => {
		state.navigate({ action: 'goto', index: 2 });
		state.removeSlide({ id: 's1' });
		const deck = state.getDeck();
		console.log('removed s1: index', deck.currentIndex, 'id', deck.slides[deck.currentIndex].id);
		assert.equal(deck.slides.length, 2);
		assert.equal(deck.currentIndex, 1);
		assert.equal(deck.slides[1].id, 's3');
	});

	it('reorder keeps the same current slide id even if its index changes', () => {
		state.navigate({ action: 'goto', index: 0 });
		state.reorder({ orderedIds: ['s3', 's1', 's2'] });
		const deck = state.getDeck();
		console.log(
			'reorder: index',
			deck.currentIndex,
			'ids',
			deck.slides.map((s) => s.id)
		);
		assert.deepEqual(
			deck.slides.map((s) => s.id),
			['s3', 's1', 's2']
		);
		assert.equal(deck.slides[deck.currentIndex].id, 's1');
		assert.equal(deck.currentIndex, 1);
	});

	it('setBlackout toggles and setBackground sets on + url', () => {
		assert.equal(state.getDeck().blackout, false);
		state.setBlackout({});
		assert.equal(state.getDeck().blackout, true);
		state.setBlackout({ on: false });
		assert.equal(state.getDeck().blackout, false);
		state.setBackground({ on: true, url: '/bg/custom.jpg' });
		const deck = state.getDeck();
		console.log('bg', deck.backgroundOn, deck.backgroundUrl, 'blackout', deck.blackout);
		assert.equal(deck.backgroundOn, true);
		assert.equal(deck.backgroundUrl, '/bg/custom.jpg');
	});

	it('loadDeck copies deck.example.json when deck.json is missing', () => {
		// beforeEach scheduled a debounce write of s1/s2/s3 — flush then delete
		// so seedFromExampleIfNeeded actually runs against this process's tmp dir.
		state.saveNow();
		const dest = path.join(tmpDir, 'deck.json');
		fs.unlinkSync(dest);
		const deck = state.loadDeck();
		console.log(
			'seeded from example: count',
			deck.slides.length,
			'first id',
			deck.slides[0] && deck.slides[0].id
		);
		assert.ok(fs.existsSync(dest), 'example should have been copied to tmp deck.json');
		assert.equal(deck.slides[0].id, 'sample-welcome');
		assert.ok(
			deck.slides.length >= 3,
			`expected sample deck length >= 3, got ${deck.slides.length}`
		);
	});
});
