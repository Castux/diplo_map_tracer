// =============================================================================
// STATE
// =============================================================================

const DEFAULT_POWERS = [
	// color names are display hints; hex is what renders
	{ id: "neutral", name: "Neutral", color: "#cccccc" },
];

let state = {
	image: null, // data URL (not persisted)
	imageW: 0,
	imageH: 0,
	territories: {}, // id -> {id, name, x, y, type: 'land'|'coast'|'sea', sc: bool, owner: powerId, coasts: ['nc','sc','ec','wc']}
	edges: [], // [{a, b}]  with a < b lex
	powers: [...DEFAULT_POWERS], // user-editable list
	selectedTerritory: null, // id
	pendingEdge: null, // id of first territory clicked in adjacencies mode
	sweepFrom: null, // id — if set, every click adds edge from this
	selectedPower: null, // powerId currently being painted in ownership mode
	mode: "territories",
	viewport: { tx: 0, ty: 0, scale: 1 },
};

let nextTerritoryId = 1;

const LS_KEY = "diplo-map-tracer-state-v1";

function getOwnerColor(ownerId) {
	if (!ownerId || ownerId === "neutral") return "#e8e0cc";
	const p = state.powers.find((pp) => pp.id === ownerId);
	return p ? p.color : "#e8e0cc";
}

function saveState() {
	const s = {
		territories: state.territories,
		edges: state.edges,
		powers: state.powers,
		nextTerritoryId,
		viewport: state.viewport,
		imageW: state.imageW,
		imageH: state.imageH,
	};
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(s));
		if (state.image) {
			localStorage.setItem(LS_KEY + "-img", state.image);
		} else {
			localStorage.removeItem(LS_KEY + "-img");
		}
		flashSaved();
	} catch (e) {
		console.error("save failed:", e);
	}
}
function loadState() {
	try {
		const raw = localStorage.getItem(LS_KEY);
		if (!raw) return false;
		const s = JSON.parse(raw);
		state.territories = s.territories || {};
		state.edges = s.edges || [];
		state.powers = s.powers && s.powers.length ? s.powers : [...DEFAULT_POWERS];
		nextTerritoryId =
			s.nextTerritoryId || Object.keys(state.territories).length + 1;
		state.viewport = s.viewport || { tx: 0, ty: 0, scale: 1 };
		state.imageW = s.imageW || 0;
		state.imageH = s.imageH || 0;
		const imgData = localStorage.getItem(LS_KEY + "-img");
		if (imgData) state.image = imgData;
		return true;
	} catch (e) {
		console.error("load failed:", e);
		return false;
	}
}

function flashSaved() {
	const el = document.getElementById("sb-saved");
	el.textContent = "✓ saved";
	el.style.opacity = 1;
	clearTimeout(flashSaved._t);
	flashSaved._t = setTimeout(() => {
		el.style.opacity = 0.6;
		el.textContent = "autosaved";
	}, 900);
}

// Undo stack
const undoStack = [];
const redoStack = [];
function pushUndo() {
	undoStack.push(
		JSON.stringify({
			territories: state.territories,
			edges: state.edges,
			powers: state.powers,
			nextTerritoryId,
		}),
	);
	if (undoStack.length > 100) undoStack.shift();
	redoStack.length = 0;
}
function undo() {
	if (!undoStack.length) return;
	redoStack.push(
		JSON.stringify({
			territories: state.territories,
			edges: state.edges,
			powers: state.powers,
			nextTerritoryId,
		}),
	);
	const s = JSON.parse(undoStack.pop());
	state.territories = s.territories;
	state.edges = s.edges;
	state.powers = s.powers;
	nextTerritoryId = s.nextTerritoryId;
	state.selectedTerritory = null;
	state.pendingEdge = null;
	state.sweepFrom = null;
	saveState();
	renderAll();
}
function redo() {
	if (!redoStack.length) return;
	undoStack.push(
		JSON.stringify({
			territories: state.territories,
			edges: state.edges,
			powers: state.powers,
			nextTerritoryId,
		}),
	);
	const s = JSON.parse(redoStack.pop());
	state.territories = s.territories;
	state.edges = s.edges;
	state.powers = s.powers;
	nextTerritoryId = s.nextTerritoryId;
	state.selectedTerritory = null;
	saveState();
	renderAll();
}

// =============================================================================
// MODE HANDLING
// =============================================================================

function setMode(m) {
	state.mode = m;
	state.pendingEdge = null;
	state.sweepFrom = null;
	document.querySelectorAll(".mode-tabs button").forEach((b) => {
		b.classList.toggle("active", b.dataset.mode === m);
	});
	const hints = {
		territories:
			"Click map to place. Click marker to edit. Drag marker to move.",
		adjacencies:
			"Click two territories to connect. Shift-click to start a neighbor sweep (Esc to finish).",
		ownership:
			"Pick a power at right, then click territories to assign. Click again to clear.",
	};
	document.getElementById("mode-hint").textContent = hints[m];
	document.getElementById("sb-mode").textContent = {
		territories: "TERR",
		adjacencies: "ADJ",
		ownership: "OWN",
	}[m];
	renderSidebar();
	renderOverlay();
}

// =============================================================================
// IMAGE LOADING
// =============================================================================

function loadImageFromFile(file) {
	const r = new FileReader();
	r.onload = (e) => {
		state.image = e.target.result;
		const img = document.getElementById("map-img");
		img.onload = () => {
			state.imageW = img.naturalWidth;
			state.imageH = img.naturalHeight;
			document.getElementById("overlay").setAttribute("width", state.imageW);
			document.getElementById("overlay").setAttribute("height", state.imageH);
			document.getElementById("drop-zone").style.display = "none";
			document.getElementById("canvas-inner").style.display = "";
			fitToScreen();
			renderAll();
		};
		img.src = state.image;
	};
	r.readAsDataURL(file);
}

function fitToScreen() {
	if (!state.imageW) return;
	const wrap = document.getElementById("canvas-wrap");
	const pad = 20;
	const sx = (wrap.clientWidth - pad * 2) / state.imageW;
	const sy = (wrap.clientHeight - pad * 2) / state.imageH;
	const s = Math.min(sx, sy, 1);
	state.viewport.scale = s;
	state.viewport.tx = (wrap.clientWidth - state.imageW * s) / 2;
	state.viewport.ty = (wrap.clientHeight - state.imageH * s) / 2;
	applyTransform();
}

function applyTransform() {
	const el = document.getElementById("canvas-inner");
	const { tx, ty, scale } = state.viewport;
	el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
	document.getElementById("sb-zoom").textContent =
		Math.round(scale * 100) + "%";
	// Keep markers a consistent screen size across zoom levels
	document.documentElement.style.setProperty("--marker-r", 6 / scale + "px");
	renderOverlay(); // marker stroke widths etc may want updating
}

// Convert client (screen) coords to image coords
function clientToImage(cx, cy) {
	const wrap = document.getElementById("canvas-wrap");
	const r = wrap.getBoundingClientRect();
	const vx = cx - r.left - state.viewport.tx;
	const vy = cy - r.top - state.viewport.ty;
	return { x: vx / state.viewport.scale, y: vy / state.viewport.scale };
}

// =============================================================================
// RENDERING
// =============================================================================

function renderAll() {
	renderOverlay();
	renderSidebar();
	renderStatus();
}

function renderOverlay() {
	const svg = document.getElementById("overlay");
	svg.setAttribute("width", state.imageW);
	svg.setAttribute("height", state.imageH);
	// Clear
	while (svg.firstChild) svg.removeChild(svg.firstChild);

	const inverseScale = 1 / state.viewport.scale;

	// Edges
	for (const e of state.edges) {
		const a = state.territories[e.a],
			b = state.territories[e.b];
		if (!a || !b) continue;
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", a.x);
		line.setAttribute("y1", a.y);
		line.setAttribute("x2", b.x);
		line.setAttribute("y2", b.y);
		line.setAttribute("class", "edge");
		line.setAttribute("stroke-width", Math.max(1.3 * inverseScale, 0.5));
		svg.appendChild(line);
	}
	// Pending edge preview
	if (state.pendingEdge) {
		const a = state.territories[state.pendingEdge];
		if (a && _mouseImg) {
			const line = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"line",
			);
			line.setAttribute("x1", a.x);
			line.setAttribute("y1", a.y);
			line.setAttribute("x2", _mouseImg.x);
			line.setAttribute("y2", _mouseImg.y);
			line.setAttribute("class", "edge pending");
			line.setAttribute("stroke-width", 1.8 * inverseScale);
			svg.appendChild(line);
		}
	}
	if (state.sweepFrom) {
		const a = state.territories[state.sweepFrom];
		if (a && _mouseImg) {
			const line = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"line",
			);
			line.setAttribute("x1", a.x);
			line.setAttribute("y1", a.y);
			line.setAttribute("x2", _mouseImg.x);
			line.setAttribute("y2", _mouseImg.y);
			line.setAttribute("class", "edge pending");
			line.setAttribute("stroke-width", 1.8 * inverseScale);
			line.setAttribute(
				"stroke-dasharray",
				`${4 * inverseScale} ${2 * inverseScale}`,
			);
			svg.appendChild(line);
		}
	}
	if (_edgeSweepActive && _edgeSweepOrigin && _mouseImg) {
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", _edgeSweepOrigin.x);
		line.setAttribute("y1", _edgeSweepOrigin.y);
		line.setAttribute("x2", _mouseImg.x);
		line.setAttribute("y2", _mouseImg.y);
		line.setAttribute("class", "edge erase-sweep");
		line.setAttribute("stroke-width", 1.5 * inverseScale);
		svg.appendChild(line);
	}

	// Markers
	for (const id in state.territories) {
		const t = state.territories[id];
		const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
		g.setAttribute(
			"class",
			"marker" + (state.selectedTerritory === id ? " selected" : ""),
		);
		g.dataset.id = id;
		g.setAttribute("transform", `translate(${t.x},${t.y})`);

		const halo = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"circle",
		);
		halo.setAttribute("class", "m-halo");
		halo.setAttribute("r", 11 * inverseScale);
		halo.setAttribute("stroke-width", 2 * inverseScale);
		g.appendChild(halo);

		// Type-based shape
		const r = 6 * inverseScale;
		const color = getOwnerColor(t.owner);
		let shape;
		if (t.type === "sea") {
			// diamond
			shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
			shape.setAttribute(
				"points",
				`0,${-r * 1.2} ${r * 1.2},0 0,${r * 1.2} ${-r * 1.2},0`,
			);
		} else if (t.type === "land") {
			// square
			shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
			shape.setAttribute("x", -r);
			shape.setAttribute("y", -r);
			shape.setAttribute("width", r * 2);
			shape.setAttribute("height", r * 2);
		} else {
			// coast: circle
			shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			shape.setAttribute("r", r);
		}
		shape.setAttribute("class", "m-dot");
		shape.setAttribute("fill", color);
		shape.setAttribute("stroke-width", 1.4 * inverseScale);
		g.appendChild(shape);

		// Supply center ring
		if (t.sc) {
			const isHome = t.owner && t.owner !== "neutral";
			const ring = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"circle",
			);
			ring.setAttribute("class", "sc-indicator" + (isHome ? " home" : ""));
			ring.setAttribute("r", r * 1.9);
			ring.setAttribute("stroke-width", (isHome ? 2 : 1.2) * inverseScale);
			g.appendChild(ring);
		}

		// Label
		const label = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"text",
		);
		label.setAttribute("class", "m-label");
		label.setAttribute("x", r * 2.2);
		label.setAttribute("y", r * 0.5);
		label.setAttribute("font-size", 11 * inverseScale);
		label.setAttribute("stroke-width", 3 * inverseScale);
		label.textContent = t.name || `?${id}`;
		g.appendChild(label);

		svg.appendChild(g);
	}
}

function renderStatus() {
	const nT = Object.keys(state.territories).length;
	const nE = state.edges.length;
	const nH = Object.values(state.territories).filter(
		(t) => t.sc && t.owner && t.owner !== "neutral",
	).length;
	document.getElementById("sb-counts").textContent =
		`${nT} terr · ${nE} edges · ${nH} home SC`;
	if (state.selectedTerritory) {
		const t = state.territories[state.selectedTerritory];
		document.getElementById("sb-sel").textContent =
			`selected: ${t.name || "(unnamed)"}`;
	} else {
		document.getElementById("sb-sel").textContent = "nothing selected";
	}
}

// =============================================================================
// SIDEBAR
// =============================================================================

function renderSidebar() {
	const sb = document.getElementById("sidebar");
	sb.innerHTML = "";

	if (state.mode === "territories") {
		sb.appendChild(sectionTerritoryEditor());
		sb.appendChild(sectionTerritoryList());
		sb.appendChild(sectionValidation());
	} else if (state.mode === "adjacencies") {
		sb.appendChild(sectionAdjacencyHelp());
		sb.appendChild(sectionSelectedAdjacencies());
		sb.appendChild(sectionTerritoryList());
	} else if (state.mode === "ownership") {
		sb.appendChild(sectionPowers());
		sb.appendChild(sectionTerritoryList());
		sb.appendChild(sectionValidation());
	}
}

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

function sectionTerritoryEditor() {
	const s = el("div", "sb-section");
	const h = el("h3");
	h.innerHTML = "Territory <span class='count' id='te-hint'></span>";
	s.appendChild(h);

	if (!state.selectedTerritory) {
		s.appendChild(
			el("div", "empty", "No territory selected. Click the map to place one."),
		);
		return s;
	}

	const t = state.territories[state.selectedTerritory];

	// Name field
	const nameF = el("div", "field");
	nameF.appendChild(el("label", null, "Name"));
	const nameInput = el("input");
	nameInput.type = "text";
	nameInput.value = t.name || "";
	nameInput.placeholder = "e.g. London";
	nameInput.addEventListener("input", () => {
		t.name = nameInput.value;
		saveState();
		renderOverlay();
		renderStatus();
		renderTerritoryListOnly();
	});
	nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			nameInput.blur();
		}
	});
	nameF.appendChild(nameInput);
	s.appendChild(nameF);
	// autofocus on new
	if (!t._nameFocused) {
		t._nameFocused = true;
		setTimeout(() => {
			nameInput.focus();
			nameInput.select();
		}, 10);
	}

	// Type radios
	const typeF = el("div", "field");
	typeF.appendChild(el("label", null, "Type   (L · C · S)"));
	const typeRow = el("div", "radio-row");
	for (const [val, lbl] of [
		["land", "Land"],
		["coast", "Coast"],
		["sea", "Sea"],
	]) {
		const id = `tt-${val}`;
		const l = el("label");
		const r = el("input");
		r.type = "radio";
		r.name = "ttype";
		r.value = val;
		r.id = id;
		r.checked = t.type === val;
		r.addEventListener("change", () => {
			pushUndo();
			t.type = val;
			if (val !== "coast") t.coasts = [];
			if (val === "sea") {
				t.owner = null;
				t.sc = false;
			}
			saveState();
			renderOverlay();
			renderSidebar();
		});
		l.appendChild(r);
		l.appendChild(document.createTextNode(lbl));
		typeRow.appendChild(l);
	}
	typeF.appendChild(typeRow);
	s.appendChild(typeF);

	// Multi-coasts (if coast)
	if (t.type === "coast") {
		const cf = el("div", "field");
		cf.appendChild(el("label", null, "Multi-coasts (optional)"));
		const cw = el("div", "coasts-editor");
		for (const c of ["nc", "sc", "ec", "wc"]) {
			const chip = el(
				"span",
				"coast-chip" + ((t.coasts || []).includes(c) ? " on" : ""),
				c.toUpperCase(),
			);
			chip.addEventListener("click", () => {
				pushUndo();
				t.coasts = t.coasts || [];
				const i = t.coasts.indexOf(c);
				if (i >= 0) t.coasts.splice(i, 1);
				else t.coasts.push(c);
				saveState();
				renderSidebar();
			});
			cw.appendChild(chip);
		}
		cf.appendChild(cw);
		s.appendChild(cf);
	}

	// Supply center
	if (t.type !== "sea") {
		const sf = el("div", "field");
		const scRow = el("div", "check-row");
		const l = el("label");
		const ch = el("input");
		ch.type = "checkbox";
		ch.checked = !!t.sc;
		ch.addEventListener("change", () => {
			pushUndo();
			t.sc = ch.checked;
			saveState();
			renderOverlay();
			renderStatus();
			renderSidebar();
		});
		l.appendChild(ch);
		l.appendChild(document.createTextNode("Supply center (S)"));
		scRow.appendChild(l);
		sf.appendChild(scRow);
		s.appendChild(sf);
	}

	// Owner (quick pick)
	if (t.type !== "sea") {
		const of = el("div", "field");
		of.appendChild(el("label", null, "Starting owner"));
		const sel = el("select");
		const optNone = el("option", null, "— neutral / unowned —");
		optNone.value = "";
		sel.appendChild(optNone);
		for (const p of state.powers) {
			if (p.id === "neutral") continue;
			const o = el("option", null, p.name);
			o.value = p.id;
			sel.appendChild(o);
		}
		sel.value = t.owner && t.owner !== "neutral" ? t.owner : "";
		sel.addEventListener("change", () => {
			pushUndo();
			t.owner = sel.value || null;
			saveState();
			renderOverlay();
			renderStatus();
			renderSidebar();
		});
		of.appendChild(sel);
		s.appendChild(of);
	}

	// Delete
	const del = el("button", "toolbtn danger", "Delete territory");
	del.style.marginTop = "8px";
	del.addEventListener("click", () => {
		if (!confirm(`Delete ${t.name || "this territory"}?`)) return;
		pushUndo();
		// remove edges mentioning it
		state.edges = state.edges.filter((e) => e.a !== t.id && e.b !== t.id);
		delete state.territories[t.id];
		state.selectedTerritory = null;
		saveState();
		renderAll();
	});
	s.appendChild(del);

	return s;
}

function renderTerritoryListOnly() {
	// cheap re-render of just the list when name changes
	const existing = document.querySelector("#sidebar .t-list-wrap");
	if (existing) {
		const listEl = existing.querySelector(".territory-list");
		listEl.innerHTML = "";
		buildTerritoryList(listEl);
	}
}

function sectionTerritoryList() {
	const s = el("div", "sb-section t-list-wrap");
	const h = el("h3");
	h.innerHTML = `Territories <span class='count'>${Object.keys(state.territories).length}</span>`;
	s.appendChild(h);

	const listEl = el("div", "territory-list");
	if (!Object.keys(state.territories).length) {
		listEl.appendChild(el("div", "empty", "No territories yet."));
	} else {
		buildTerritoryList(listEl);
	}
	s.appendChild(listEl);
	return s;
}

function buildTerritoryList(listEl) {
	const entries = Object.values(state.territories).sort((a, b) =>
		(a.name || "").localeCompare(b.name || ""),
	);
	for (const t of entries) {
		const row = el(
			"div",
			"t-row" + (state.selectedTerritory === t.id ? " selected" : ""),
		);
		const type = el("span", "t-type", t.type[0].toUpperCase());
		const name = el("span", null, t.name || "(unnamed)");
		name.style.flex = "1";
		row.appendChild(type);
		row.appendChild(name);
		if (t.sc) row.appendChild(el("span", "t-sc", "●"));
		if (t.owner && t.owner !== "neutral") {
			const sw = el("span");
			sw.style.width = "10px";
			sw.style.height = "10px";
			sw.style.background = getOwnerColor(t.owner);
			sw.style.border = "1px solid #111";
			sw.style.display = "inline-block";
			row.appendChild(sw);
		}
		row.addEventListener("click", () => {
			state.selectedTerritory = t.id;
			panTo(t.x, t.y);
			renderAll();
		});
		listEl.appendChild(row);
	}
}

function sectionAdjacencyHelp() {
	const s = el("div", "sb-section");
	const h = el("h3");
	h.textContent = "Adjacencies";
	s.appendChild(h);

	const info = el("div");
	info.style.fontSize = "12px";
	info.style.lineHeight = "1.6";
	info.innerHTML = `
    <p style="margin:0 0 6px"><b>Single pair:</b> click A, then B.</p>
    <p style="margin:0 0 6px"><b>Neighbor sweep:</b> hold <kbd>Shift</kbd> and click A to fix it. Every click after adds A↔X. Press <kbd>Esc</kbd> to stop.</p>
    <p style="margin:0 0 6px"><b>Remove edge:</b> click-drag across an edge line, or use the selected-territory list below.</p>
  `;
	s.appendChild(info);

	if (state.sweepFrom) {
		const t = state.territories[state.sweepFrom];
		const banner = el("div");
		banner.style.marginTop = "8px";
		banner.style.padding = "6px 8px";
		banner.style.background = "var(--accent)";
		banner.style.color = "var(--paper)";
		banner.style.fontSize = "12px";
		banner.textContent = `Sweeping from: ${t.name || t.id}. Click neighbors. Esc to stop.`;
		s.appendChild(banner);
	}

	return s;
}

function sectionSelectedAdjacencies() {
	const s = el("div", "sb-section");
	const h = el("h3");
	h.textContent = "Neighbors of selected";
	s.appendChild(h);
	if (!state.selectedTerritory) {
		s.appendChild(el("div", "empty", "Click a marker to see its neighbors."));
		return s;
	}
	const id = state.selectedTerritory;
	const neighbors = state.edges
		.filter((e) => e.a === id || e.b === id)
		.map((e) => (e.a === id ? e.b : e.a))
		.map((nid) => state.territories[nid])
		.filter(Boolean)
		.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

	const list = el("div", "territory-list");
	if (!neighbors.length) {
		list.appendChild(
			el("div", "empty", "No neighbors. Click another territory to connect."),
		);
	} else {
		for (const n of neighbors) {
			const row = el("div", "t-row");
			const name = el("span", null, n.name || "(unnamed)");
			name.style.flex = "1";
			const rm = el("button", "small-btn", "×");
			rm.addEventListener("click", (ev) => {
				ev.stopPropagation();
				pushUndo();
				state.edges = state.edges.filter(
					(e) =>
						!((e.a === id && e.b === n.id) || (e.a === n.id && e.b === id)),
				);
				saveState();
				renderAll();
			});
			row.appendChild(name);
			row.appendChild(rm);
			list.appendChild(row);
		}
	}
	s.appendChild(list);
	return s;
}

function sectionPowers() {
	const s = el("div", "sb-section");
	const h = el("h3");
	h.innerHTML = `Powers <span class='count'>${state.powers.filter((p) => p.id !== "neutral").length}</span>`;
	s.appendChild(h);

	const info = el("div", "hint");
	info.style.fontSize = "11px";
	info.style.marginBottom = "8px";
	info.innerHTML =
		"Pick a power, then click territories. Click a territory a second time to clear. Number keys <kbd>1</kbd>–<kbd>9</kbd> select powers.";
	s.appendChild(info);

	const list = el("div", "power-list");
	const realPowers = state.powers.filter((p) => p.id !== "neutral");

	realPowers.forEach((p, i) => {
		const row = el(
			"div",
			"power-row" + (state.selectedPower === p.id ? " selected" : ""),
		);
		const sw = el("span", "power-swatch");
		sw.style.background = p.color;
		row.appendChild(sw);

		// Editable name
		const nn = el("input");
		nn.type = "text";
		nn.value = p.name;
		nn.style.flex = "1";
		nn.style.background = "transparent";
		nn.style.border = "none";
		nn.style.font = "inherit";
		nn.style.fontSize = "12px";
		nn.style.color =
			state.selectedPower === p.id ? "var(--paper)" : "var(--ink)";
		nn.style.padding = "0";
		nn.addEventListener("input", () => {
			p.name = nn.value;
			saveState();
			renderTerritoryListOnly();
		});
		nn.addEventListener("click", (ev) => ev.stopPropagation());
		row.appendChild(nn);

		// Count
		const homeCount = Object.values(state.territories).filter(
			(t) => t.sc && t.owner === p.id,
		).length;
		const target = p.count || 0;
		let cls = "pc-count";
		if (target > 0) {
			if (homeCount === target) cls += " ok";
			else if (homeCount > target) cls += " over";
			else cls += " under";
		}
		const c = el("span", cls);
		if (target > 0) c.textContent = `${homeCount}/${target}`;
		else c.textContent = `${homeCount}`;
		row.appendChild(c);

		if (i < 9) row.appendChild(el("span", "key-hint", i + 1));
		row.addEventListener("click", () => {
			state.selectedPower = state.selectedPower === p.id ? null : p.id;
			renderAll();
		});

		// Right-click: edit color / count / remove
		row.addEventListener("contextmenu", (ev) => {
			ev.preventDefault();
			openPowerEditor(p);
		});
		list.appendChild(row);
	});

	// Add-power row
	const add = el("button", "small-btn");
	add.textContent = "+ Add power";
	add.style.marginTop = "8px";
	add.addEventListener("click", () => {
		pushUndo();
		const newId = "p" + Math.random().toString(36).slice(2, 7);
		const hues = [0, 30, 60, 120, 180, 210, 270, 330, 45, 90, 150, 240, 300];
		const idx = realPowers.length % hues.length;
		state.powers.push({
			id: newId,
			name: "Power " + (realPowers.length + 1),
			color: `hsl(${hues[idx]} 55% 55%)`,
			count: 0,
		});
		saveState();
		renderSidebar();
	});
	s.appendChild(list);
	s.appendChild(add);

	// Hint: right-click to edit
	const h2 = el("div", "hint");
	h2.style.fontSize = "10px";
	h2.style.marginTop = "4px";
	h2.textContent =
		"Right-click a power to change color / home-SC target / delete.";
	s.appendChild(h2);

	return s;
}

function openPowerEditor(p) {
	const bg = el("div", "modal-bg");
	const m = el("div", "modal");
	m.innerHTML = `
    <h2>Edit power</h2>
    <div class="field"><label>Name</label><input type="text" id="pe-name" value="${escapeHtml(p.name)}"></div>
    <div class="field"><label>Color (CSS color or #hex)</label><input type="text" id="pe-color" value="${escapeHtml(p.color)}"></div>
    <div class="field"><label>Home SC target count (0 for unknown)</label><input type="text" id="pe-count" value="${p.count || 0}"></div>
    <div class="actions">
      <button class="toolbtn danger" id="pe-del">Delete power</button>
      <div class="spacer" style="flex:1"></div>
      <button class="toolbtn" id="pe-cancel">Cancel</button>
      <button class="toolbtn" id="pe-save" style="background:var(--ink);color:var(--paper)">Save</button>
    </div>
  `;
	bg.appendChild(m);
	document.body.appendChild(bg);
	m.querySelector("#pe-name").focus();

	m.querySelector("#pe-cancel").onclick = () => bg.remove();
	bg.onclick = (ev) => {
		if (ev.target === bg) bg.remove();
	};
	m.querySelector("#pe-save").onclick = () => {
		pushUndo();
		p.name = m.querySelector("#pe-name").value || p.name;
		p.color = m.querySelector("#pe-color").value || p.color;
		p.count = parseInt(m.querySelector("#pe-count").value) || 0;
		saveState();
		bg.remove();
		renderAll();
	};
	m.querySelector("#pe-del").onclick = () => {
		if (
			!confirm(
				`Delete power ${p.name}? Territories owned by it become neutral.`,
			)
		)
			return;
		pushUndo();
		for (const t of Object.values(state.territories)) {
			if (t.owner === p.id) t.owner = null;
		}
		state.powers = state.powers.filter((pp) => pp.id !== p.id);
		if (state.selectedPower === p.id) state.selectedPower = null;
		saveState();
		bg.remove();
		renderAll();
	};
}

function escapeHtml(s) {
	return (s || "").replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c],
	);
}

function sectionValidation() {
	const s = el("div", "sb-section");
	const h = el("h3");
	h.textContent = "Validation";
	s.appendChild(h);

	const issues = validate();
	const box = el("div", "validation");
	if (!issues.length) {
		box.appendChild(line("v-ok", "✓ No issues."));
	} else {
		for (const issue of issues) {
			box.appendChild(line("v-" + issue.sev, issue.msg));
		}
	}
	s.appendChild(box);
	return s;

	function line(cls, text) {
		const d = el("div", "v-line " + cls);
		d.textContent = text;
		return d;
	}
}

function validate() {
	const issues = [];
	// No unnamed
	for (const t of Object.values(state.territories)) {
		if (!t.name || !t.name.trim()) {
			issues.push({ sev: "warn", msg: `Unnamed territory (${t.id})` });
		}
	}
	// Unique names
	const names = {};
	for (const t of Object.values(state.territories)) {
		if (!t.name) continue;
		names[t.name] = (names[t.name] || 0) + 1;
	}
	for (const n in names)
		if (names[n] > 1) {
			issues.push({ sev: "err", msg: `Duplicate name "${n}" × ${names[n]}` });
		}
	// Sea can't have owner/sc
	for (const t of Object.values(state.territories)) {
		if (t.type === "sea" && (t.owner || t.sc)) {
			issues.push({ sev: "err", msg: `Sea "${t.name}" has owner/SC` });
		}
	}
	// Power home-SC counts
	for (const p of state.powers) {
		if (p.id === "neutral" || !p.count) continue;
		const actual = Object.values(state.territories).filter(
			(t) => t.sc && t.owner === p.id,
		).length;
		if (actual !== p.count) {
			issues.push({
				sev: actual > p.count ? "err" : "warn",
				msg: `${p.name}: ${actual}/${p.count} home SC${actual === p.count ? "" : actual > p.count ? " (too many)" : " (missing)"}`,
			});
		}
	}
	// Sea↔land direct (without coast) warning
	for (const e of state.edges) {
		const a = state.territories[e.a],
			b = state.territories[e.b];
		if (!a || !b) {
			issues.push({ sev: "err", msg: `Dangling edge ${e.a}↔${e.b}` });
			continue;
		}
		if (
			(a.type === "sea" && b.type === "land") ||
			(a.type === "land" && b.type === "sea")
		) {
			issues.push({
				sev: "warn",
				msg: `${a.name}(land) ↔ ${b.name}(sea) — should one be coast?`,
			});
		}
	}
	return issues;
}

// =============================================================================
// CANVAS INTERACTION
// =============================================================================

let _mouseImg = null; // current mouse pos in image coords
let _dragging = false;
let _panStart = null;
let _panActive = false;
let _dragMarker = null;
let _spaceHeld = false;
let _shiftHeld = false;
let _edgeSweepActive = false;
let _edgeSweepStart = null; // image coords of last processed point (advances each move)
let _edgeSweepOrigin = null; // image coords where sweep began (for visual)
let _edgeSweepDidRemove = false;

const wrap = () => document.getElementById("canvas-wrap");

function onMouseMove(e) {
	const img = clientToImage(e.clientX, e.clientY);
	_mouseImg = img;
	document.getElementById("sb-cursor").textContent =
		`${Math.round(img.x)}, ${Math.round(img.y)}`;

	if (_panActive && _panStart) {
		state.viewport.tx = _panStart.tx + (e.clientX - _panStart.x);
		state.viewport.ty = _panStart.ty + (e.clientY - _panStart.y);
		applyTransform();
		return;
	}
	if (_dragMarker) {
		const t = state.territories[_dragMarker];
		t.x = img.x;
		t.y = img.y;
		renderOverlay();
		return;
	}
	if (_edgeSweepActive && _edgeSweepStart) {
		const cur = img;
		const removed = [];
		for (const edge of state.edges) {
			const a = state.territories[edge.a],
				b = state.territories[edge.b];
			if (!a || !b) continue;
			if (
				segmentsIntersect(
					_edgeSweepStart.x,
					_edgeSweepStart.y,
					cur.x,
					cur.y,
					a.x,
					a.y,
					b.x,
					b.y,
				)
			) {
				removed.push(edge);
			}
		}
		if (removed.length > 0) {
			if (!_edgeSweepDidRemove) {
				pushUndo();
				_edgeSweepDidRemove = true;
			}
			const removedSet = new Set(removed.map((e) => e.a + "~" + e.b));
			state.edges = state.edges.filter((e) => !removedSet.has(e.a + "~" + e.b));
			saveState();
		}
		_edgeSweepStart = cur;
		renderOverlay();
		return;
	}
	// Hover updates for pending edges/sweep
	if (state.mode === "adjacencies" && (state.pendingEdge || state.sweepFrom)) {
		renderOverlay();
	}
}

function onMouseDown(e) {
	if (e.button !== 0) return;
	if (_spaceHeld) {
		_panActive = true;
		_panStart = {
			x: e.clientX,
			y: e.clientY,
			tx: state.viewport.tx,
			ty: state.viewport.ty,
		};
		wrap().classList.add("panning");
		return;
	}

	// Detect click on marker
	const target = findMarkerAt(e.clientX, e.clientY);
	if (target) {
		handleMarkerClick(target, e);
	} else {
		if (
			state.mode === "adjacencies" &&
			!state.pendingEdge &&
			!state.sweepFrom &&
			!e.shiftKey
		) {
			_edgeSweepActive = true;
			_edgeSweepStart = clientToImage(e.clientX, e.clientY);
			_edgeSweepOrigin = { ..._edgeSweepStart };
			_edgeSweepDidRemove = false;
		} else {
			handleEmptyClick(e);
		}
	}
}

function onMouseUp(e) {
	if (_panActive) {
		_panActive = false;
		wrap().classList.remove("panning");
	}
	if (_dragMarker) {
		pushUndo(); // undoable: actually the drag moved the marker
		saveState();
		_dragMarker = null;
	}
	if (_edgeSweepActive) {
		_edgeSweepActive = false;
		_edgeSweepStart = null;
		_edgeSweepOrigin = null;
		_edgeSweepDidRemove = false;
		renderOverlay();
	}
}

function findMarkerAt(cx, cy) {
	const wrapEl = wrap();
	const r = wrapEl.getBoundingClientRect();
	const vx = cx - r.left,
		vy = cy - r.top;
	// Search in screen space
	const radiusScreen = 12;
	let best = null,
		bestD = radiusScreen * radiusScreen;
	for (const id in state.territories) {
		const t = state.territories[id];
		const sx = t.x * state.viewport.scale + state.viewport.tx;
		const sy = t.y * state.viewport.scale + state.viewport.ty;
		const d = (sx - vx) ** 2 + (sy - vy) ** 2;
		if (d < bestD) {
			bestD = d;
			best = id;
		}
	}
	return best;
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
	const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
	const d1 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
	const d2 = cross(dx - cx, dy - cy, bx - cx, by - cy);
	const d3 = cross(bx - ax, by - ay, cx - ax, cy - ay);
	const d4 = cross(bx - ax, by - ay, dx - ax, dy - ay);
	if (
		((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
		((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
	)
		return true;
	return false;
}

function handleMarkerClick(id, e) {
	if (state.mode === "territories") {
		state.selectedTerritory = id;
		// also prep for drag-move
		_dragMarker = id;
		renderAll();
	} else if (state.mode === "adjacencies") {
		// Sweep logic: shift+click sets/releases sweep anchor
		if (e.shiftKey) {
			state.sweepFrom = state.sweepFrom === id ? null : id;
			state.pendingEdge = null;
			state.selectedTerritory = id;
			renderAll();
			return;
		}
		if (state.sweepFrom) {
			if (id !== state.sweepFrom) addEdge(state.sweepFrom, id);
			renderAll();
			return;
		}
		if (!state.pendingEdge) {
			state.pendingEdge = id;
			state.selectedTerritory = id;
		} else if (state.pendingEdge === id) {
			state.pendingEdge = null;
			state.selectedTerritory = null;
		} else {
			addEdge(state.pendingEdge, id);
			state.pendingEdge = null;
			state.selectedTerritory = id;
		}
		renderAll();
	} else if (state.mode === "ownership") {
		if (!state.selectedPower) {
			state.selectedTerritory = id;
			renderAll();
			return;
		}
		const t = state.territories[id];
		if (t.type === "sea") return;
		pushUndo();
		t.owner = t.owner === state.selectedPower ? null : state.selectedPower;
		saveState();
		state.selectedTerritory = id;
		renderAll();
	}
}

function handleEmptyClick(e) {
	if (state.mode === "territories") {
		const img = clientToImage(e.clientX, e.clientY);
		if (img.x < 0 || img.y < 0 || img.x > state.imageW || img.y > state.imageH)
			return;
		pushUndo();
		const id = "t" + String(nextTerritoryId++).padStart(4, "0");
		state.territories[id] = {
			id,
			name: "",
			x: img.x,
			y: img.y,
			type: "land",
			sc: false,
			owner: null,
			coasts: [],
		};
		state.selectedTerritory = id;
		saveState();
		renderAll();
	} else if (state.mode === "adjacencies") {
		// Click on empty space cancels pending edge but keeps sweep
		if (state.pendingEdge) {
			state.pendingEdge = null;
			renderAll();
		}
	}
}

function addEdge(a, b) {
	if (a === b) return;
	if (a > b) {
		const t = a;
		a = b;
		b = t;
	}
	if (state.edges.some((e) => e.a === a && e.b === b)) return;
	pushUndo();
	state.edges.push({ a, b });
	saveState();
}

function panTo(imgX, imgY) {
	const wrapEl = wrap();
	state.viewport.tx = wrapEl.clientWidth / 2 - imgX * state.viewport.scale;
	state.viewport.ty = wrapEl.clientHeight / 2 - imgY * state.viewport.scale;
	applyTransform();
}

// Wheel zoom
function onWheel(e) {
	if (!state.imageW) return;
	e.preventDefault();
	const delta = -e.deltaY;
	const factor = Math.exp(delta * 0.0015);
	const newScale = Math.max(0.05, Math.min(8, state.viewport.scale * factor));
	// Zoom toward cursor
	const r = wrap().getBoundingClientRect();
	const cx = e.clientX - r.left,
		cy = e.clientY - r.top;
	const ratio = newScale / state.viewport.scale;
	state.viewport.tx = cx - (cx - state.viewport.tx) * ratio;
	state.viewport.ty = cy - (cy - state.viewport.ty) * ratio;
	state.viewport.scale = newScale;
	applyTransform();
	saveState();
}

// =============================================================================
// KEYBOARD
// =============================================================================

function onKeyDown(e) {
	// Ignore if typing in an input
	const tag = (e.target.tagName || "").toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") {
		if (e.key === "Escape") e.target.blur();
		return;
	}

	if (e.key === " ") {
		e.preventDefault();
		_spaceHeld = true;
		wrap().classList.add("pan-ready");
		return;
	}
	if (e.key === "Shift") _shiftHeld = true;

	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
		e.preventDefault();
		if (e.shiftKey) redo();
		else undo();
		return;
	}
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
		e.preventDefault();
		redo();
		return;
	}

	if (e.key === "1") setMode("territories");
	else if (e.key === "2") setMode("adjacencies");
	else if (e.key === "3") setMode("ownership");
	else if (e.key === "Escape") {
		state.pendingEdge = null;
		state.sweepFrom = null;
		state.selectedTerritory = null;
		renderAll();
	} else if (e.key === "f") {
		if (state.imageW) fitToScreen();
	} else if (e.key === "Delete" || e.key === "Backspace") {
		if (state.selectedTerritory) {
			const t = state.territories[state.selectedTerritory];
			if (confirm(`Delete ${t.name || "this territory"}?`)) {
				pushUndo();
				state.edges = state.edges.filter(
					(ed) => ed.a !== t.id && ed.b !== t.id,
				);
				delete state.territories[t.id];
				state.selectedTerritory = null;
				saveState();
				renderAll();
			}
		}
	} else if (state.mode === "territories" && state.selectedTerritory) {
		const t = state.territories[state.selectedTerritory];
		if (e.key === "l" || e.key === "L") {
			pushUndo();
			t.type = "land";
			saveState();
			renderAll();
		} else if (e.key === "c" || e.key === "C") {
			pushUndo();
			t.type = "coast";
			saveState();
			renderAll();
		} else if (e.key === "s") {
			pushUndo();
			t.type = "sea";
			t.sc = false;
			t.owner = null;
			saveState();
			renderAll();
		} else if (e.key === "S") {
			if (t.type !== "sea") {
				pushUndo();
				t.sc = !t.sc;
				saveState();
				renderAll();
			}
		}
	} else if (state.mode === "ownership") {
		const n = parseInt(e.key);
		if (!isNaN(n) && n >= 1 && n <= 9) {
			const realPowers = state.powers.filter((p) => p.id !== "neutral");
			if (realPowers[n - 1]) {
				state.selectedPower = realPowers[n - 1].id;
				renderAll();
			}
		} else if (e.key === "0") {
			state.selectedPower = null;
			renderAll();
		}
	}
}

function onKeyUp(e) {
	if (e.key === " ") {
		_spaceHeld = false;
		wrap().classList.remove("pan-ready");
	}
	if (e.key === "Shift") _shiftHeld = false;
}

// =============================================================================
// EXPORT / IMPORT
// =============================================================================

function exportJSON() {
	// Build name-keyed output. Use name when available, else id.
	const ref = (t) => (t.name && t.name.trim()) || t.id;

	const powers = {};
	for (const p of state.powers) {
		if (p.id === "neutral") continue;
		const homes = Object.values(state.territories)
			.filter((t) => t.sc && t.owner === p.id)
			.map(ref)
			.sort();
		powers[p.name] = {
			color: p.color,
			declared_home_sc_count: p.count || null,
			actual_home_sc_count: homes.length,
			home_supply_centers: homes,
		};
	}

	const territories = {};
	// adjacency lookup
	const adjByT = {};
	for (const e of state.edges) {
		(adjByT[e.a] ||= []).push(e.b);
		(adjByT[e.b] ||= []).push(e.a);
	}
	const sortedTs = Object.values(state.territories).sort((a, b) =>
		(a.name || a.id).localeCompare(b.name || b.id),
	);
	for (const t of sortedTs) {
		const adj = (adjByT[t.id] || [])
			.map((nid) => state.territories[nid])
			.filter(Boolean)
			.map(ref)
			.sort();
		const ownerName = state.powers.find((p) => p.id === t.owner)?.name || null;
		territories[ref(t)] = {
			type: t.type,
			supply_center: !!t.sc,
			owner: ownerName,
			coasts: t.coasts && t.coasts.length ? t.coasts : undefined,
			adjacent: adj,
			_pos: { x: Math.round(t.x), y: Math.round(t.y) },
		};
	}

	const out = {
		variant_name: "Untitled Diplomacy Variant",
		generated_by: "Diplo Map Tracer",
		generated_at: new Date().toISOString(),
		stats: {
			territories: sortedTs.length,
			edges: state.edges.length,
			supply_centers: sortedTs.filter((t) => t.sc).length,
			home_supply_centers: sortedTs.filter(
				(t) => t.sc && t.owner && t.owner !== "neutral",
			).length,
		},
		powers,
		territories,
	};

	const blob = new Blob([JSON.stringify(out, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "diplo_map_extraction.json";
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importJSON(obj) {
	// Be permissive: accept our own export format, or raw {territories, edges, powers}.
	if (!confirm("Importing will replace the current extraction. Proceed?"))
		return;
	pushUndo();

	if (obj.territories && !Array.isArray(obj.territories) && obj.powers) {
		// Looks like our exported format (name-keyed territories)
		state.territories = {};
		state.edges = [];
		state.powers = [{ id: "neutral", name: "Neutral", color: "#cccccc" }];

		const nameToId = {};
		let next = 1;

		// Powers first
		for (const pname in obj.powers) {
			const p = obj.powers[pname];
			state.powers.push({
				id: "p" + Math.random().toString(36).slice(2, 7),
				name: pname,
				color: p.color || "#888",
				count: p.declared_home_sc_count || p.actual_home_sc_count || 0,
			});
		}

		for (const tname in obj.territories) {
			const td = obj.territories[tname];
			const id = "t" + String(next++).padStart(4, "0");
			nameToId[tname] = id;
			const ownerPower = state.powers.find((p) => p.name === td.owner);
			state.territories[id] = {
				id,
				name: tname,
				x: td._pos?.x ?? Math.random() * (state.imageW || 1000),
				y: td._pos?.y ?? Math.random() * (state.imageH || 1000),
				type: td.type || "land",
				sc: !!td.supply_center,
				owner: ownerPower?.id || null,
				coasts: td.coasts || [],
			};
		}
		nextTerritoryId = next;
		// Edges from adjacency lists
		const seen = new Set();
		for (const tname in obj.territories) {
			const td = obj.territories[tname];
			const a = nameToId[tname];
			for (const nname of td.adjacent || []) {
				const b = nameToId[nname];
				if (!b || !a) continue;
				const key = a < b ? `${a}|${b}` : `${b}|${a}`;
				if (seen.has(key)) continue;
				seen.add(key);
				state.edges.push(a < b ? { a, b } : { a: b, b: a });
			}
		}
	} else {
		alert(
			"Unrecognized JSON shape. Expected {territories:{name:{...}}, powers:{...}}.",
		);
		return;
	}

	saveState();
	renderAll();
}

// =============================================================================
// WIRING
// =============================================================================

function init() {
	// Try to restore previous session
	const restored = loadState();

	// Mode tabs
	document.querySelectorAll(".mode-tabs button").forEach((b) => {
		b.addEventListener("click", () => setMode(b.dataset.mode));
	});

	// Load image button
	document.getElementById("btn-load-image").onclick = () => {
		document.getElementById("file-input").click();
	};
	document.getElementById("file-input").onchange = (e) => {
		if (e.target.files[0]) loadImageFromFile(e.target.files[0]);
	};
	// Drop zone
	const dz = document.getElementById("drop-zone");
	const cw = document.getElementById("canvas-wrap");
	["dragenter", "dragover"].forEach((evt) => {
		cw.addEventListener(evt, (e) => {
			e.preventDefault();
			if (!state.image) dz.classList.add("drag-over");
		});
	});
	["dragleave", "drop"].forEach((evt) => {
		cw.addEventListener(evt, (e) => {
			e.preventDefault();
			dz.classList.remove("drag-over");
		});
	});
	cw.addEventListener("drop", (e) => {
		e.preventDefault();
		if (
			e.dataTransfer.files[0] &&
			e.dataTransfer.files[0].type.startsWith("image/")
		) {
			loadImageFromFile(e.dataTransfer.files[0]);
		}
	});

	// Export / Import / Reset
	document.getElementById("btn-export").onclick = exportJSON;
	document.getElementById("btn-import").onclick = () => {
		document.getElementById("import-input").click();
	};
	document.getElementById("import-input").onchange = (e) => {
		const f = e.target.files[0];
		if (!f) return;
		const r = new FileReader();
		r.onload = (ev) => {
			try {
				const obj = JSON.parse(ev.target.result);
				importJSON(obj);
			} catch (err) {
				alert("Invalid JSON: " + err.message);
			}
		};
		r.readAsText(f);
	};
	document.getElementById("btn-reset").onclick = () => {
		if (
			!confirm("This will erase all territories, edges, and powers. Continue?")
		)
			return;
		state.territories = {};
		state.edges = [];
		state.powers = [...DEFAULT_POWERS];
		nextTerritoryId = 1;
		state.selectedTerritory = null;
		state.pendingEdge = null;
		state.sweepFrom = null;
		state.selectedPower = null;
		saveState();
		renderAll();
	};
	document.getElementById("btn-help").onclick = toggleHelp;

	// Canvas interaction
	cw.addEventListener("mousedown", onMouseDown);
	document.addEventListener("mousemove", onMouseMove);
	document.addEventListener("mouseup", onMouseUp);
	cw.addEventListener("wheel", onWheel, { passive: false });
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);

	window.addEventListener("resize", () => {
		if (state.imageW) applyTransform();
	});

	setMode("territories");

	if (restored) {
		if (state.image) {
			const imgEl = document.getElementById("map-img");
			imgEl.onload = () => {
				document.getElementById("overlay").setAttribute("width", state.imageW);
				document.getElementById("overlay").setAttribute("height", state.imageH);
				document.getElementById("drop-zone").style.display = "none";
				document.getElementById("canvas-inner").style.display = "";
				applyTransform();
				renderAll();
			};
			imgEl.src = state.image;
		} else {
			renderAll();
		}
	}
}

function toggleHelp() {
	let h = document.querySelector(".help");
	if (h) {
		h.remove();
		return;
	}
	h = document.createElement("div");
	h.className = "help";
	h.innerHTML = `
    <button class="close">×</button>
    <h4>Keyboard</h4>
    <table style="border-collapse:collapse; font-size:12px;">
      <tr><td style="padding:2px 10px 2px 0"><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd></td><td>Mode: Terr / Adj / Own</td></tr>
      <tr><td><kbd>Space</kbd>+drag</td><td>Pan the map</td></tr>
      <tr><td>Scroll</td><td>Zoom (toward cursor)</td></tr>
      <tr><td><kbd>F</kbd></td><td>Fit map to screen</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Cancel current action / deselect</td></tr>
      <tr><td><kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd></td><td>Undo · <kbd>Shift</kbd>+<kbd>Z</kbd> redo</td></tr>
      <tr><td><kbd>Del</kbd></td><td>Delete selected territory</td></tr>
      <tr><td colspan="2" style="padding-top:10px; font-weight:600">Territory mode</td></tr>
      <tr><td><kbd>L</kbd> / <kbd>C</kbd> / <kbd>s</kbd></td><td>Set type: Land / Coast / Sea</td></tr>
      <tr><td><kbd>Shift</kbd>+<kbd>S</kbd></td><td>Toggle supply center</td></tr>
      <tr><td colspan="2" style="padding-top:10px; font-weight:600">Adjacency mode</td></tr>
      <tr><td><kbd>Shift</kbd>+click</td><td>Start neighbor sweep</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Stop sweep</td></tr>
      <tr><td colspan="2" style="padding-top:10px; font-weight:600">Ownership mode</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Select power (via list order)</td></tr>
      <tr><td><kbd>0</kbd></td><td>Deselect power</td></tr>
    </table>
  `;
	document.body.appendChild(h);
	h.querySelector(".close").onclick = () => h.remove();
}

init();
