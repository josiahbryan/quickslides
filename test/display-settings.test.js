// Display-settings defaults + normalize. The browser file and the server
// file must stay identical on DEFAULTS — a drift would mean Control and
// /present disagree about "reset to defaults."
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const server = require('../server/display-settings');
const browser = require('../public/js/display-settings');

describe('display settings', () => {
	it('server and browser DEFAULTS match', () => {
		console.log('server DEFAULTS', server.DEFAULTS);
		console.log('browser DEFAULTS', browser.DEFAULTS);
		assert.deepEqual(browser.DEFAULTS, server.DEFAULTS);
	});

	it('normalize fills defaults for empty input', () => {
		const got = server.normalize({ raw: {} });
		console.log('empty normalize', got);
		assert.deepEqual(got, server.DEFAULTS);
	});

	it('normalize clamps pads and keeps a usable font range', () => {
		const got = server.normalize({
			raw: {
				tvSafePadY: 9,
				tvSafePadX: -1,
				fitMinPx: 200,
				fitMaxPx: 40,
				crossfadeMs: -50,
				bgCrossfadeMultiplier: 99,
			},
		});
		console.log('clamped', got);
		assert.equal(got.tvSafePadY, 0.4);
		assert.equal(got.tvSafePadX, 0);
		assert.equal(got.fitMinPx, 40);
		assert.equal(got.fitMaxPx, 200);
		assert.equal(got.crossfadeMs, 0);
		assert.equal(got.bgCrossfadeMultiplier, 20);
	});

	it('bgCrossfadeMs is crossfade * multiplier', () => {
		const settings = server.normalize({
			raw: { crossfadeMs: 500, bgCrossfadeMultiplier: 3 },
		});
		const ms = server.bgCrossfadeMs({ settings });
		console.log(
			'bgCrossfadeMs',
			ms,
			'from',
			settings.crossfadeMs,
			'*',
			settings.bgCrossfadeMultiplier
		);
		assert.equal(ms, 1500);
	});
});
