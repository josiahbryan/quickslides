// Path resolution for the importer. We never run a real import here — that
// would need a copyrighted .pptx. We only check that a missing path does not
// silently fall back to a hardcoded /Users/... location.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePptxPath } = require('../server/import-path');

describe('import-cli resolvePptxPath', () => {
	it('prefers the CLI argument over env', () => {
		const got = resolvePptxPath({
			argvPath: '/tmp/from-argv.pptx',
			envPath: '/tmp/from-env.pptx',
		});
		console.log('argv wins:', got);
		assert.equal(got, '/tmp/from-argv.pptx');
	});

	it('uses QUICKSLIDES_PPTX when no argv path is given', () => {
		const got = resolvePptxPath({
			argvPath: undefined,
			envPath: '/tmp/from-env.pptx',
		});
		console.log('env fallback:', got);
		assert.equal(got, '/tmp/from-env.pptx');
	});

	it('returns null when nothing is provided and the home default is absent', () => {
		// HOME_DEFAULT is "~/Downloads/Worship Set - Slides Final.pptx".
		// On CI / most machines that file does not exist, so we expect null.
		// If it DOES exist on this machine, the helper returns that path — also
		// correct, and we print it instead of pretending we got null.
		const got = resolvePptxPath({ argvPath: undefined, envPath: undefined });
		console.log('no-args result:', got);
		if (got === null) {
			assert.equal(got, null);
		} else {
			assert.match(got, /Worship Set - Slides Final\.pptx$/);
		}
	});
});
