# QuickSlides

A minimal live-sync slides app for running lyrics / worship sets. Edit and drive
from one Chrome window (**Control**) and project from another (**Presentation**).
Both stay in sync over WebSockets.

No build step. No framework. Node + Express + `ws` + vanilla HTML/JS.

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
- `gh` CLI if you want to push to GitHub (already used to host this repo)

## Install

```bash
npm install
```

## Import slides from a .pptx (text + order only)

```bash
# Defaults to "~/Downloads/Worship Set - Slides Final.pptx"
npm run import

# or an explicit path:
node server/import-cli.js "/absolute/path/to/YourDeck.pptx"
```

Writes `data/deck.json`. Slide 1 of the source deck is often a solid-black
title with no image; the first *used* background photo is exported separately
as `public/bg/default.jpg`.

## Run

```bash
npm start
# default port 4000; override with PORT=xxxx npm start
```

Open two Chrome windows:

- Control:       http://localhost:4000/
- Presentation:  http://localhost:4000/present

Put Presentation on the projector and fullscreen it (F11).

**No HMR.** After changing JS/CSS, refresh the window that loads that file
(Control and/or `/present`). After changing `server/` files, restart `npm start`.

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
- **+ Add slide** — blank slide after the selection (this *does* become current
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

Default photo is `public/bg/default.jpg` (first background image used in the
source PPTX — slide 1 itself had no image).

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
  public/
    control.html
    present.html
    bg/default.jpg     # default projector background
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
    deck.json          # persisted deck
```

## Data model

`data/deck.json`:

```json
{
  "currentIndex": 0,
  "blackout": false,
  "backgroundOn": false,
  "backgroundUrl": "/bg/default.jpg",
  "slides": [
    { "id": "uuid", "text": "line one\nline two" }
  ]
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
