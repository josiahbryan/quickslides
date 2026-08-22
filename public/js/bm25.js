// bm25.js
// -----------------------------------------------------------------------------
// Tiny BM25 ranker for the control-window slide search. No dependencies.
//
// Why BM25 instead of substring indexOf: worship lyrics repeat a lot ("holy",
// "lord") and the operator is hunting a *specific* slide. BM25 down-weights
// terms that appear on almost every slide (IDF) and up-weights slides where
// the query terms are concentrated (TF, length-normalized). That surfaces
// "living hope" ahead of every slide that merely contains "hope".
//
// Exposed as window.Bm25 because the page loads plain <script> tags.
// Also module.exports so Node tests can require this file without a DOM.
// -----------------------------------------------------------------------------

(function attachBm25(global) {
	// BM25 free parameters. k1 controls term-frequency saturation (1.2–2.0 is
	// the usual range); b controls how much we penalize long documents (0–1).
	// These defaults are the textbook Okapi values and work well on short lyric
	// slides without any tuning.
	const K1 = 1.5;
	const B = 0.75;

	// Split text into lowercase tokens. Apostrophes stay inside a token so
	// "you're" remains one term; everything else is a separator.
	function tokenize({ text }) {
		return String(text || '')
			.toLowerCase()
			.split(/[^a-z0-9']+/)
			.filter((t) => t.length > 0);
	}

	// Rank slides by BM25 score against `query`. Returns only slides with
	// score > 0, best first. Each hit: { id, index, score }.
	function rankSlides({ slides, query }) {
		const queryTokens = tokenize({ text: query });
		if (!queryTokens.length || !Array.isArray(slides) || slides.length === 0) {
			return [];
		}

		const docs = slides.map((s) => tokenize({ text: s.text }));
		const N = docs.length;
		let totalLen = 0;
		for (const tokens of docs) totalLen += tokens.length;
		const avgdl = totalLen / N || 1;

		// Document frequency per unique query term (how many slides contain it).
		const uniqueQuery = Array.from(new Set(queryTokens));
		const df = new Map();
		for (const term of uniqueQuery) {
			let n = 0;
			for (const tokens of docs) {
				if (tokens.indexOf(term) !== -1) n += 1;
			}
			df.set(term, n);
		}

		const hits = [];
		for (let index = 0; index < slides.length; index++) {
			const tokens = docs[index];
			const tfMap = new Map();
			for (const t of tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);

			let score = 0;
			for (const term of queryTokens) {
				const nq = df.get(term) || 0;
				if (nq === 0) continue;
				// Lucene-style IDF (always non-negative): log((N-n+0.5)/(n+0.5)+1)
				const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1);
				const tf = tfMap.get(term) || 0;
				const dl = tokens.length || 1;
				score += (idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + B * (dl / avgdl)));
			}

			if (score > 0) {
				hits.push({ id: slides[index].id, index, score });
			}
		}

		// Higher score first; ties keep original deck order (stable enough).
		hits.sort((a, b) => b.score - a.score || a.index - b.index);
		return hits;
	}

	const api = { tokenize, rankSlides };
	// Node tests: require('.../bm25.js') gets the same { tokenize, rankSlides }.
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	// Browser: control.html loads this as a classic script.
	if (global) {
		global.Bm25 = api;
	}
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
