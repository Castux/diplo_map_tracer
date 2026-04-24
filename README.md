# Diplo Map Tracer

A browser-based tool for extracting and mapping [Diplomacy](https://en.wikipedia.org/wiki/Diplomacy_(game)) game variants. Load a map image, annotate territories and adjacencies, assign ownership to powers, and export the result as structured JSON.

No installation, no build step — open `diplo_map_tracer.html` in any modern browser and start annotating.

---

## Getting started

Open `diplo_map_tracer.html` directly in your browser, or serve with any static server:

```bash
python -m http.server 8000
# then visit http://localhost:8000/diplo_map_tracer.html
```

Load a map image by clicking the image area or dragging and dropping an image file onto it. All work is saved automatically to browser `localStorage` and persists across sessions.

---

## Modes

The editor has three modes, switched with keys **1**, **2**, **3**.

### 1 — Territories
Click the map to place territory markers. Select a marker to edit its properties in the sidebar:
- **Name** — display name (e.g. "London")
- **Type** — Land, Coast, or Sea
- **Multi-coast** — North/South/East/West coast variants for coastal territories
- **Supply center** — toggle to mark as a supply center
- **Starting owner** — assign a starting owner for the opening position

Drag markers to reposition them. Delete with **Delete** / **Backspace** (asks for confirmation).

### 2 — Adjacencies
Draw connections between territories representing which ones border each other.

- **Single pair**: click territory A, then territory B to connect them.
- **Neighbor sweep**: **Shift+click** a territory to fix it as the anchor, then click other territories to connect each of them to the anchor. Press **Esc** to stop sweeping.
- **Remove edges**: click-drag across an existing edge line to delete it.

### 3 — Ownership
Assign territories to powers (nations/players).

- Select a power from the right panel (or press its number key **1–9**), then click territories to assign them. Click an already-owned territory to clear it.
- **Right-click** a power to edit its color, set its home supply center target, or delete it.

---

## Keyboard shortcuts

### Global

| Key | Action |
|-----|--------|
| `1` / `2` / `3` | Switch to Territories / Adjacencies / Ownership mode |
| `Space` + drag | Pan the map |
| Scroll wheel | Zoom in/out toward cursor |
| `F` | Fit map to screen |
| `Esc` | Cancel action / deselect |
| `Ctrl`/`⌘` + `Z` | Undo |
| `Shift` + `Z` &nbsp;or&nbsp; `Ctrl`/`⌘` + `Y` | Redo |
| `Delete` / `Backspace` | Delete selected territory |
| `?` | Toggle help panel |

### Territories mode

| Key | Action |
|-----|--------|
| `L` | Set type to Land |
| `C` | Set type to Coast |
| `S` | Set type to Sea |
| `Shift` + `S` | Toggle supply center |

---

## Export / Import

- **Export JSON** — downloads a `.json` file containing all territories (positions, names, types, adjacencies) and powers (colors, home supply centers).
- **Import JSON** — loads a previously exported file, restoring the full session.

---

## Validation

The editor checks for common errors and warns about:
- Unnamed territories or duplicate names
- Sea territories incorrectly marked as supply centers or assigned an owner
- Mismatches between a power's home supply center count and its target
- Suspicious direct adjacencies between sea and inland land territories

---

## Tech stack

Vanilla HTML/CSS/JavaScript — no frameworks, no dependencies, no build step.
