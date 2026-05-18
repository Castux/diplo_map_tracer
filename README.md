# Diplo Map Tracer

A browser-based tool for extracting and mapping [Diplomacy](https://en.wikipedia.org/wiki/Diplomacy_(game)) game variants. Load a map image, annotate territories and adjacencies, assign ownership to powers, and export the result as structured JSON.

## Getting started

Visit the live version on https://castux.github.io/diplo_map_tracer/

Or run locally: open `index.html` directly in your browser, or serve with any static server:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

Load a map image by clicking **Load map…** or dragging an image file onto the canvas. All work autosaves to browser `localStorage` and persists across sessions.

**Disclaimer: despite the built-in safeties, it is HIGHLY RECOMMENDED you backup your work often in a different location, so it is not lost or overwritten with corrupted data.**

## Modes

Switched with keys **1** – **4**.

### 1 — Territories

Click the map to place a territory marker. Select a marker to edit its properties in the sidebar:

- **Name** — display name (e.g. "London")
- **Type** — Land, Coast, or Sea
- **Supply center** — toggle to mark as a supply center
- **Starting owner** — assign an initial owner for the opening position

Drag markers to reposition them. Delete the selected territory with **Delete** / **Backspace**.

### 2 — Adjacencies

Draw connections between territories representing which ones border each other.

- **Single pair** — click territory A, then territory B to connect them.
- **Remove edges** — click-drag across an existing edge line to erase it; or use the × button next to a neighbor in the sidebar.
- **Edge types** — each connection is typed as *army* (land-only), *fleet* (water-capable), or *both*. The type is inferred automatically from the territory types when an edge is created. Click an edge line to select it, then use the sidebar buttons or the **A / B / F** keys to override it.

### 3 — Ownership

Assign territories to powers.

- Select a power from the right panel, then click territories to assign them. Click an already-owned territory to clear it.
- **Right-click** a power row to edit its name, color, or delete it.
- **+ Add power** adds a new power with an auto-assigned color.

### 4 — Graph

A force-directed layout of the territory adjacency graph, useful for spotting connectivity issues.

- Drag nodes to rearrange. Click a node to toggle its **anchor** (anchored nodes are held in place by the simulation).
- Outer hull nodes are anchored automatically on first load to keep the graph from collapsing.
- **Reset Layout** rerandomizes positions and re-anchors the hull.
- **Pause / Resume** the spring simulation.
- **Spring length** and **Repulsion** sliders tune the physics.
- **Show adjacency count** colours nodes by degree (blue → low, red → high).

## Keyboard shortcuts

### Global

| Key | Action |
|-----|--------|
| `1` / `2` / `3` / `4` | Switch mode |
| `Space` + drag | Pan the map |
| Scroll wheel | Zoom toward cursor |
| `F` | Fit map to screen |
| `Esc` | Cancel current action / deselect |
| `Ctrl`/`⌘` + `Z` | Undo |
| `Shift` + `Z` or `Ctrl`/`⌘` + `Y` | Redo |
| `Delete` / `Backspace` | Delete selected territory |

### Territories mode

| Key | Action |
|-----|--------|
| `L` | Set type to Land |
| `C` | Set type to Coast |
| `s` | Set type to Sea |
| `Shift` + `S` | Toggle supply center |

### Adjacencies mode

| Key | Action |
|-----|--------|
| `Esc` | Cancel pending edge |
| `A` | Set selected edge type to Army |
| `B` | Set selected edge type to Both |
| `F` | Set selected edge type to Fleet |

## Export / Import

Click **Export JSON** to save the full extraction as a `.json` file. On browsers that support the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (Chrome/Edge), the button changes to **Save JSON** after the first export and writes directly back to the same file on subsequent saves.

**Import JSON** loads a previously exported file, restoring all territories, adjacencies, powers, and graph layout.

## Validation

The sidebar shows a live validation panel in both Territories and Adjacencies modes. It checks for:

- Unnamed territories or duplicate names
- Sea territories incorrectly marked as supply centers or assigned an owner
- Edges whose explicit type conflicts with what would be inferred from the territory types
- Dangling edges referencing deleted territories

## Tech stack

Vanilla HTML/CSS/JavaScript — no frameworks, no dependencies, no build step. Source is split across `js/state.js`, `js/render.js`, `js/sidebar.js`, `js/interaction.js`, `js/graph.js`, and `js/main.js`.

## License

Copyright 2026 Noé Falzon, released under the [MIT license](LICENSE.md). I would love to hear if you modify or include this project into yours!
