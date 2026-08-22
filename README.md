# QuickSlides

[![CI](https://github.com/josiahbryan/quickslides/actions/workflows/ci.yml/badge.svg)](https://github.com/josiahbryan/quickslides/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A minimal live-sync slides app for running lyrics / worship sets. Edit and drive
from one Chrome window (**Control**) and project from another (**Presentation**).
Both stay in sync over WebSockets.

No build step. No framework. Node + Express + `ws` + vanilla HTML/JS.

**License:** [MIT](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) if you want
to send a change, and [SECURITY.md](SECURITY.md) before you expose the port to
a network.

---

## What it does

- **Two windows, one source of truth**
  - `/` — Control: operator console (edit, search, add/remove/reorder, navigate).
  - `/present` — Presentation: full-screen viewer only. Never edits.
- **Live sync via WebSockets.** The server holds the deck and broadcasts full
  state after every change.
- **Persistent on disk.** `data/deck.json` (debounced writes) survives restarts.
- **Import text + order from a `.pptx`.** Text only, real presentation order
  (not filename order). Blank slides are kept.

---

## Requirements

- Node.js 18+ (developed on Node 22)
- `gh` CLI only if you are publishing your own fork to GitHub

## Install

```bash
npm install
```

## Import slides from a .pptx (text + order only)

```bash
# Pass the .pptx path (required unless QUICKSLIDES_PPTX is set, or the
# historical "~/Downloads/Worship Set - Slides Final.pptx" file exists):
npm run import -- "/absolute/path/to/YourDeck.pptx"
```

Writes `data/deck.json` (gitignored — local only). Slide 1 of many decks is a
solid-black title with no image; copy a background you have rights to into
`public/bg/default.jpg` if you want a default photo.

## Run

```bash
npm start
# default port 4000; override with PORT=xxxx npm start
```

Open two Chrome windows:

- Control: http://localhost:4000/
- Presentation: http://localhost:4000/present

Put Presentation on the projector and fullscreen it (F11).

**No HMR.** After changing JS/CSS, refresh the window that loads that file
(Control and/or `/present`). After changing `server/` files, restart `npm start`.

A first run with no `data/deck.json` copies `data/deck.example.json` so you
have a tiny original sample deck.

## Develop

```bash
npm test            # node:test (must print real values + assert)
npm run lint        # ESLint
npm run format      # Prettier write
npm run format:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, how to test a UI
change, and what not to commit.

---

## Control window

### Navigation (changes the projector)

- Big **Prev** / **Next**, or `←` / `→` / Space / PageUp / PageDown when you
  are **not** typing in an input.
- **Show on screen**
- **Double-click** a list row
- **Enter** in the search box (shows the selected match)

Single-click a list row selects it for editing only. It does **not** change
the projector.

### Editing

- Type in the editor. Each newline is a line on the projector. Debounced live
  push (~150ms).
- **+ Add slide** — blank slide after the selection (this _does_ become current
  on the projector).
- **Duplicate** — copy after the selected slide. Projector stays put.
- **Delete** — per-row ✕ or editor Delete (confirms).
- **Reorder** — ↑ / ↓ or drag-and-drop.

The left list shows **full slide text** (multi-line). Next/Prev and search
arrows scroll the relevant row to the **center**. List clicks do not scroll
(so the row does not jump out from under the mouse).

### Search (BM25)

Box at the top of the list. Ranks slides by lyric content.

- `1/X matches` chip with ← → (or arrow keys while the box is focused)
- Steps **selection only** — projector unchanged
- Enter = Show on screen
- ✕ (or emptying the box) clears search and scrolls the live slide back to center

### Preview

Right-hand 16:9 stage uses the same TV-safe padding, min/max font, and wrap
rules as `/present` (fonts scaled from a 1920-wide projector). Updates as you
type. Amber outline + **LIVE** badge when the previewed slide is the one on
the projector.

### Black / background

- **Black** — fades a full-screen black veil in/out (`CROSSFADE_MS`). Does not
  change the current slide.
- **BG** — fades the background photo in/out (same duration).
- **Load BG** — upload a JPEG/PNG/WebP (saved as `public/bg/custom.*`, turns BG on).

Default photo is `public/bg/default.jpg` if you ship one. Operator uploads
land in `public/bg/custom.*` and are gitignored.

---

## Presentation window

- Full-screen black stage, white lyrics, auto-fit.
- Tweaks live in `public/js/present.js` (refresh `/present` after changing):
  - `TV_SAFE_PAD_Y` / `TV_SAFE_PAD_X` — overscan padding (fractions of viewport)
  - `FIT_MAX_PX` / `FIT_MIN_PX` — font cap / floor. At the floor, long lines wrap
  - `SHOW_CURSOR` — mouse pointer on the projector
  - `CROSSFADE_MS` — overlap crossfade for slide changes, blackout, and BG
- Connection dot (bottom-left) and dim `n / total` (bottom-right).

---

## Project layout

```
quickslides/
  server/
    index.js           # Express + WebSocket + background upload
    state.js           # In-memory deck + data/deck.json + mutations
    protocol.js        # WebSocket message-type constants (server)
    pptx-import.js     # .pptx -> { slides:[{id,text}] }
    import-cli.js      # CLI: import and persist
    import-path.js     # resolves the .pptx path (argv / env / Downloads)
  public/
    control.html
    present.html
    bg/default.jpg     # optional default projector background
    js/
      protocol.js      # same constants for the browser (window.MSG)
      ws-client.js     # auto-reconnecting WebSocket
      bm25.js          # slide search ranker
      slide-fit.js     # shared lyric layout (control preview)
      control.js
      control-list.js
      control-preview.js
      present.js
    css/
      control.css
      present.css
  data/
    deck.example.json  # original sample lyrics (safe to publish)
    deck.json          # local operator deck (gitignored)
```

## Data model

`data/deck.json`:

```json
{
  "currentIndex": 0,
  "blackout": false,
  "backgroundOn": false,
  "backgroundUrl": "/bg/default.jpg",
  "slides": [{ "id": "uuid", "text": "line one\nline two" }]
}
```

## WebSocket protocol

Server → client: `{ type: "state", state: { currentIndex, slides, blackout, backgroundOn, backgroundUrl } }`

Client → server:

- `{ type: "nav", action: "next"|"prev"|"goto", index? }`
- `{ type: "editSlide", id, text }`
- `{ type: "addSlide", afterIndex }` (`-1` = start)
- `{ type: "duplicateSlide", id }`
- `{ type: "removeSlide", id }`
- `{ type: "reorder", orderedIds: [...] }`
- `{ type: "blackout", on? }` (omit `on` to toggle)
- `{ type: "background", on? }` (omit `on` to toggle)

Background image upload is HTTP `POST /api/background` (raw image body), not a
WebSocket message.

---

## License and copyright (read this before making the repo public)

The **code** is [MIT](LICENSE). That does **not** give you (or this repo) the
right to publish other people's **songs, lyrics, or photos**.

Worship-set `.pptx` files are almost always a mix of CCLI/licensed lyrics and
stock or church photography. If you flip this GitHub repo from private to
public:

1. Do **not** commit `data/deck.json` (already gitignored going forward).
2. Remove it from git history if it was committed earlier
   (`git rm --cached data/deck.json`, then a history rewrite if it is already
   on GitHub).
3. Replace `public/bg/default.jpg` with an image you own or that is clearly
   licensed for redistribution — or delete it.
4. Turn on
   [private vulnerability reporting](https://github.com/josiahbryan/quickslides/settings/security_analysis)
   (see [SECURITY.md](SECURITY.md)).

The sample deck in `data/deck.example.json` is original placeholder text.

This server has **no login**. Anyone who can reach the port can edit the live
deck. Keep it on localhost or a trusted LAN. See [SECURITY.md](SECURITY.md).
