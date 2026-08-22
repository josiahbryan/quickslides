# Contributing to QuickSlides

This file is written for someone who has never contributed here before.
You do not need to know the history of the project. Read this, then the
README, then the file you want to change.

## What this project is

QuickSlides is a **two-window lyrics app**:

- **Control** (`/`) — the operator edits and drives slides
- **Presentation** (`/present`) — the projector. It never edits.

The **Node server** is the source of truth. Browsers never invent their own
deck. After any change, the server broadcasts the **entire** deck state over
a WebSocket. Both windows just render that snapshot.

There is **no bundler and no hot reload**. Vanilla HTML/JS, served as static
files from `public/`.

## Before you write code

1. Fork (or clone) the repo.
2. `npm install`
3. `npm start` and open the two URLs in the README.
4. `npm test` and `npm run lint` — both must pass on `main` before you start.
   If they do not, stop and say so in your PR; do not "fix" them by weakening
   assertions.

A first clone has no `data/deck.json`. The server copies
`data/deck.example.json` on first load so you have a tiny original sample
deck. **Do not commit `data/deck.json`.** That file is your local set list
and often contains other people's copyrighted lyrics.

## How to propose a change

1. Open an issue first if the change is more than a typo or a one-line bug
   fix. Say what is broken or missing, and how you would check it is fixed.
2. Create a branch from `main`. Name it after the issue (`fix/search-enter`,
   `docs/license`, etc.).
3. Keep the pull request small. One problem per PR.
4. Fill in the PR template. "I tested it" is not enough — say **what you
   clicked, what you typed, and what you saw**.

## Project rules (please follow these)

These are how this repo stays readable. They are not optional style nits.

- **Named parameters.** Functions take one object and destructure it:
  `navigate({ action, index })`, not `navigate(action, index)`.
- **No default exports.** Use `module.exports = { foo }` on the server and
  `window.Foo = ...` in the browser. The only reason this project uses
  globals in `public/js` is that there is no bundler.
- **No `arguments` object.** Use named or rest parameters.
- **Comments explain why.** A junior engineer should be able to read a new
  helper and know what it is for in the real world (operator, projector,
  disk, WebSocket), not just what the syntax does.
- **Do not add a framework, bundler, or TypeScript** unless a maintainer
  agrees first. The whole point is "refresh the tab."
- **Do not add dependencies by hand-editing `package.json`.** Use
  `npm i -S <pkg>` or `npm i -D <pkg>`.
- **Never commit `node_modules/`, `data/deck.json`, or `public/bg/custom.*`.**
- **Never commit copyrighted lyrics or photos** that you do not have the
  right to redistribute. The importer copies _text_ from a `.pptx`; that
  text is usually not yours to publish.

## Where to put code

| If you are changing…      | Edit                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| Deck mutations, disk save | `server/state.js`                                                  |
| HTTP / WebSocket wiring   | `server/index.js`                                                  |
| Message type strings      | `server/protocol.js` **and** `public/js/protocol.js` (must match)  |
| PPTX parsing              | `server/pptx-import.js`                                            |
| Import CLI path rules     | `server/import-path.js`                                            |
| Control window behavior   | `public/js/control.js` (+ `control-list.js`, `control-preview.js`) |
| Search ranking            | `public/js/bm25.js`                                                |
| Projector layout          | `public/js/present.js` (and keep `slide-fit.js` constants in sync) |
| Styles                    | `public/css/control.css` or `present.css`                          |

If a file is getting long, split a helper out. Do not dump more inline logic
into the HTML.

### No hot reload — how to see your change

- Changed a file under `public/` → refresh **that** Chrome tab (Control
  and/or Presentation). Cmd+R / Ctrl+R.
- Changed a file under `server/` → stop `npm start` and start it again.
  The operator must refresh both windows after a restart so they reconnect.

Do not drive someone else's live Presentation window. If they are projecting
to an audience, tell them to refresh themselves.

## Tests

This repo uses Node's built-in test runner (`node:test`) and the built-in
`assert` module. **No fake pass messages.**

A test must:

1. Measure or compute a real value.
2. `assert` it against an expected value.
3. Print the actual numbers / strings you got (so a failure is debuggable).

Preferred shape for a table of cases:

```js
const cases = [{ name: 'empty query', input: { query: '' }, expected: [] }];
```

If you change deck mutations, protocol strings, BM25, or the PPTX parser,
add or update a test in `test/`. If you change Control/Presentation UI,
say in the PR exactly how you exercised it in the browser (this project
does not yet run Playwright in CI).

Run:

```bash
npm test
npm run lint
```

`npm test` must not write to your real `data/deck.json`. The state tests
point `QUICKSLIDES_DATA_DIR` at a temp folder. If you add a test that
`require`s `server/state.js`, do the same.

## Lint and format

- `npm run lint` — ESLint on `server/`, `public/js/`, and `test/`.
- `npm run format` — Prettier write (tabs in JS, 2-space YAML/Markdown).
- `npm run format:check` — Prettier check (used in CI).

Match the file you are in: existing JS uses **tabs** and **single quotes**.

## Commit messages

Short, why-focused, imperative:

- `Fix search Enter so it shows the selected match`
- `Document MIT license and local-only security model`

Do not use `git add -A` or `git add .`. Add only the files you meant to
change, by path.

## Code of conduct

By participating you agree to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
