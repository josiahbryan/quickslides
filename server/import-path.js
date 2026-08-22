// Resolves which .pptx the import CLI should read.
//
// Kept in its own file so tests can cover path rules without require()ing
// state.js (which would bind DATA_DIR and risk writing the operator deck).
const fs = require('fs');
const os = require('os');
const path = require('path');

// Historical operator convenience: if this exact Downloads file exists,
// `npm run import` with no args still works. We do not hardcode
// /Users/<name>/... — homedir is resolved at runtime.
const HOME_DEFAULT = path.join(os.homedir(), 'Downloads', 'Worship Set - Slides Final.pptx');

function resolvePptxPath({ argvPath, envPath }) {
	if (argvPath) return argvPath;
	if (envPath) return envPath;
	if (fs.existsSync(HOME_DEFAULT)) return HOME_DEFAULT;
	return null;
}

module.exports = { resolvePptxPath, HOME_DEFAULT };
