// BM25 ranker tests. These load the same file the Control window loads
// (public/js/bm25.js). Scores are not hardcoded "magic pass" values — we
// assert *ordering* and print the real scores so a regression is obvious.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, rankSlides } = require('../public/js/bm25');

describe('Bm25.tokenize', () => {
	const cases = [
		{ name: 'empty string', input: { text: '' }, expected: [] },
		{ name: 'nullish', input: { text: null }, expected: [] },
		{
			name: 'keeps apostrophes as one token',
			input: { text: "you're loved" },
			expected: ["you're", 'loved'],
		},
		{
			name: 'lowercases and splits on punctuation',
			input: { text: 'Living Hope!' },
			expected: ['living', 'hope'],
		},
	];

	for (const { name, input, expected } of cases) {
		it(name, () => {
			const got = tokenize({ text: input.text });
			console.log(`tokenize "${name}": got`, got);
			assert.deepEqual(got, expected);
		});
	}
});

describe('Bm25.rankSlides', () => {
	// Synthetic slides: one specific title, several that only share a common word.
	// This is the real operator problem — "hope" is on many slides; they want
	// the slide that is actually about "living hope".
	const slides = [
		{ id: 'a', text: 'Hope\nWe have hope' },
		{ id: 'b', text: 'Living hope\nJesus Christ my living hope' },
		{ id: 'c', text: 'Great is your faithfulness' },
		{ id: 'd', text: 'Hope of the nations\nhope hope hope' },
	];

	it('returns [] for an empty query', () => {
		const hits = rankSlides({ slides, query: '   ' });
		console.log('empty query hits:', hits.length);
		assert.equal(hits.length, 0);
	});

	it('returns [] for an empty deck', () => {
		const hits = rankSlides({ slides: [], query: 'hope' });
		console.log('empty deck hits:', hits.length);
		assert.equal(hits.length, 0);
	});

	it('ranks the specific "living hope" slide above generic hope slides', () => {
		const hits = rankSlides({ slides, query: 'living hope' });
		console.log(
			'living hope ranking:',
			hits.map((h) => ({ id: h.id, index: h.index, score: h.score }))
		);
		assert.ok(hits.length >= 2, `expected at least 2 hits, got ${hits.length}`);
		assert.equal(hits[0].id, 'b', `top hit was ${hits[0].id} with score ${hits[0].score}`);
		const scoreB = hits.find((h) => h.id === 'b').score;
		const scoreA = hits.find((h) => h.id === 'a').score;
		assert.ok(scoreB > scoreA, `expected slide b (${scoreB}) > slide a (${scoreA})`);
	});

	it('does not return slides that share no query terms', () => {
		const hits = rankSlides({ slides, query: 'living hope' });
		const ids = hits.map((h) => h.id);
		console.log('ids for "living hope":', ids);
		assert.equal(ids.includes('c'), false);
	});
});
