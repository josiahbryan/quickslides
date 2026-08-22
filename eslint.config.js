// Flat ESLint config (ESLint 9+). Two environments, one repo:
//   - server/ and test/ run in Node (require, process, Buffer)
//   - public/js/ runs in the browser (window, document)
//
// We use the recommended rule set plus eslint-config-prettier so ESLint
// never fights Prettier about spacing/quotes. If you want to change
// formatting, change Prettier, not ESLint.
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
	{
		ignores: ['node_modules/**', 'data/**', 'public/bg/**'],
	},
	js.configs.recommended,
	prettier,
	{
		files: ['server/**/*.js', 'test/**/*.js', 'eslint.config.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: {
				...globals.node,
			},
		},
		rules: {
			// Unused args that start with _ are intentional "I know this exists
			// but I am not using it" markers (Express (_req, res), regex (_m, hex)).
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['public/js/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'script',
			globals: {
				...globals.browser,
			},
		},
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	},
	// bm25.js is a classic browser script AND a Node module (tests require it).
	// `module` is a real CommonJS binding in Node and undefined in the browser;
	// we only *read* it inside `typeof module !== 'undefined'`.
	{
		files: ['public/js/bm25.js', 'public/js/display-settings.js'],
		languageOptions: {
			globals: {
				module: 'readonly',
			},
		},
	},
];
