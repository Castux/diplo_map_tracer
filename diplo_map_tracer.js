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
	territories: {}, // id -> {id, name, x, y, type: 'land'|'coast'|'sea', sc: bool, owner: powerId}
	edges: [], // [{a, b, type: 'army'|'fleet'|'both'}]
	powers: [...DEFAULT_POWERS], // user-editable list
	selectedTerritory: null, // id
	pendingEdge: null, // id of first territory clicked in adjacencies mode
	selectedEdge: null, // {a, b} edge selected in adjacencies mode
	selectedPower: null, // powerId currently being painted in ownership mode
	mode: "territories",
	viewport: { tx: 0, ty: 0, scale: 1 },
};

let nextTerritoryId = 1;
let jsonFileHandle = null; // FileSystemFileHandle when a file is open via FSA

const LS_KEY = "diplo-map-tracer-state-v1";
const FSA_SUPPORTED = typeof window.showOpenFilePicker === "function";

function getOwnerColor(ownerId) {
	if (!ownerId || ownerId === "neutral") return "#e8e0cc";
	const p = state.powers.find((pp) => pp.id === ownerId);
	return p ? p.color : "#e8e0cc";
}

function saveState() {
	const graphNodeData = {};
	for (const id in graphNodes) {
		const n = graphNodes[id];
		graphNodeData[id] = { x: n.x, y: n.y, anchored: n.anchored };
	}
	const s = {
		territories: state.territories,
		edges: state.edges,
		powers: state.powers,
		nextTerritoryId,
		viewport: state.viewport,
		imageW: state.imageW,
		imageH: state.imageH,
		graph: {
			tensionFactor: graphTensionFactor,
			repulsionFactor: graphRepulsionFactor,
			nodes: graphNodeData,
		},
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
		if (s.graph) {
			graphTensionFactor = s.graph.tensionFactor ?? 0.5;
			graphRepulsionFactor = s.graph.repulsionFactor ?? 0.32;
			for (const id in (s.graph.nodes || {})) {
				const nd = s.graph.nodes[id];
				graphNodes[id] = { x: nd.x, y: nd.y, vx: 0, vy: 0, pinned: false, anchored: !!nd.anchored };
			}
		}
		return true;
	} catch (e) {
		console.error("load failed:", e);
		return false;
	}
}

function flashSaved(msg = "✓ saved", duration = 900) {
	const el = document.getElementById("sb-saved");
	el.textContent = msg;
	el.style.opacity = 1;
	clearTimeout(flashSaved._t);
	flashSaved._t = setTimeout(() => {
		el.style.opacity = 0.6;
		el.textContent = "autosaved";
	}, duration);
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
	const wasGraph = state.mode === "graph";
	const isGraph = m === "graph";

	state.mode = m;
	state.pendingEdge = null;
	state.selectedEdge = null;
	document.querySelectorAll(".mode-tabs button").forEach((b) => {
		b.classList.toggle("active", b.dataset.mode === m);
	});
	const hints = {
		territories:
			"Click map to place. Click marker to edit. Drag marker to move.",
		adjacencies:
			"Click two territories to connect. Drag across an edge to remove it.",
		ownership:
			"Pick a power at right, then click territories to assign. Click again to clear.",
		graph: "Drag nodes to rearrange. Simulation applies spring physics in real time.",
	};
	document.getElementById("mode-hint").textContent = hints[m] || "";
	document.getElementById("sb-mode").textContent = {
		territories: "TERR",
		adjacencies: "ADJ",
		ownership: "OWN",
		graph: "GRAPH",
	}[m] || m.toUpperCase();

	if (isGraph) {
		document.getElementById("canvas-wrap").style.display = "none";
		document.getElementById("graph-view").style.display = "";
		const hadSavedNodes = Object.keys(graphNodes).length > 0;
		syncGraphNodes(false);
		graphRestLen = computeAvgEdgeDist() * graphTensionFactor;
		if (!hadSavedNodes) pinHullNodes();
		fitGraphToScreen();
		startGraphSim();
	} else {
		if (wasGraph) {
			stopGraphSim();
			document.getElementById("graph-view").style.display = "none";
			document.getElementById("canvas-wrap").style.display = "";
		}
		renderOverlay();
	}

	renderSidebar();
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
	document.documentElement.style.setProperty("--marker-r", 8 / scale + "px");
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
		const edgeType = e.type || "both";
		const isSelected = state.selectedEdge &&
			state.selectedEdge.a === e.a && state.selectedEdge.b === e.b;

		// Wide invisible hit area for clicking
		const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
		hit.setAttribute("x1", a.x); hit.setAttribute("y1", a.y);
		hit.setAttribute("x2", b.x); hit.setAttribute("y2", b.y);
		hit.setAttribute("stroke", "rgba(0,0,0,0.01)");
		hit.setAttribute("stroke-width", 12 * inverseScale);
		hit.setAttribute("class", "edge-hit");
		hit.dataset.a = e.a; hit.dataset.b = e.b;
		hit.addEventListener("mousedown", (ev) => {
			if (state.mode !== "adjacencies") return;
			ev.stopPropagation(); // prevent sweep from starting
		});
		hit.addEventListener("click", (ev) => {
			if (state.mode !== "adjacencies") return;
			ev.stopPropagation();
			const same = state.selectedEdge &&
				state.selectedEdge.a === e.a && state.selectedEdge.b === e.b;
			state.selectedEdge = same ? null : { a: e.a, b: e.b };
			state.pendingEdge = null;
			renderAll();
		});
		svg.appendChild(hit);

		// Visible line
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
		line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
		const sw = Math.max(4.0 * inverseScale, 1.2);
		line.setAttribute("stroke-width", sw);
		const cls = "edge" +
			(edgeType === "army" ? " edge-army" : edgeType === "fleet" ? " edge-fleet" : "") +
			(isSelected ? " edge-selected" : "");
		line.setAttribute("class", cls);
		if (edgeType === "army")
			line.setAttribute("stroke-dasharray", `${6 * inverseScale} ${4 * inverseScale}`);
		else if (edgeType === "fleet")
			line.setAttribute("stroke-dasharray", `${2 * inverseScale} ${3 * inverseScale}`);
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
			line.setAttribute("stroke-width", 2.6 * inverseScale);
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
		line.setAttribute("stroke-width", 2.2 * inverseScale);
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
		halo.setAttribute("r", 15 * inverseScale);
		halo.setAttribute("stroke-width", 2.5 * inverseScale);
		g.appendChild(halo);

		// Type-based shape
		const r = 8 * inverseScale;
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
		shape.setAttribute("stroke-width", 2.0 * inverseScale);
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
			ring.setAttribute("stroke-width", (isHome ? 2.8 : 1.8) * inverseScale);
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
		label.setAttribute("font-size", 14 * inverseScale);
		label.setAttribute("stroke-width", 4 * inverseScale);
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
		sb.appendChild(sectionSelectedEdge());
		sb.appendChild(sectionSelectedAdjacencies());
		sb.appendChild(sectionTerritoryList());
	} else if (state.mode === "ownership") {
		sb.appendChild(sectionPowers());
		sb.appendChild(sectionTerritoryList());
		sb.appendChild(sectionValidation());
	} else if (state.mode === "graph") {
		sb.appendChild(sectionGraphControls());
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
    <p style="margin:0 0 6px"><b>Remove edge:</b> click-drag across an edge line, or use the selected-territory list below.</p>
  `;
	s.appendChild(info);

	const fixable = state.edges.filter(e => {
		const ta = state.territories[e.a]?.type, tb = state.territories[e.b]?.type;
		if (ta === "coast" && tb === "coast") return false; // ambiguous
		return (e.type || "both") !== inferEdgeType(e.a, e.b);
	});
	if (fixable.length) {
		const btn = el("button", "toolbtn");
		btn.textContent = `Fix ${fixable.length} edge${fixable.length > 1 ? "s" : ""} to inferred type`;
		btn.style.cssText = "width:100%; margin-top:6px;";
		btn.addEventListener("click", () => {
			pushUndo();
			for (const e of fixable) e.type = inferEdgeType(e.a, e.b);
			saveState();
			renderAll();
		});
		s.appendChild(btn);
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

function sectionSelectedEdge() {
	const s = el("div", "sb-section");
	s.appendChild(el("h3", null, "Selected edge"));
	const e = state.selectedEdge;
	if (!e) {
		s.appendChild(el("div", "empty", "Click an edge to select it."));
		return s;
	}
	const ta = state.territories[e.a], tb = state.territories[e.b];
	if (!ta || !tb) return s;
	const edge = state.edges.find(ed => ed.a === e.a && ed.b === e.b);
	if (!edge) return s;

	const desc = el("div");
	desc.style.cssText = "font-size:12px; margin-bottom:10px; line-height:1.5;";
	desc.textContent = `${ta.name || "(unnamed)"} — ${tb.name || "(unnamed)"}`;
	s.appendChild(desc);

	const inferred = inferEdgeType(e.a, e.b);
	const hint = el("div", "hint");
	hint.style.marginBottom = "8px";
	hint.textContent = `Inferred: ${inferred}`;
	s.appendChild(hint);

	const btnRow = el("div");
	btnRow.style.cssText = "display:flex; gap:6px;";
	for (const type of ["army", "both", "fleet"]) {
		const btn = el("button", "toolbtn");
		btn.textContent = type;
		btn.style.flex = "1";
		if (edge.type === type) {
			btn.style.background = "var(--ink)";
			btn.style.color = "var(--paper)";
		}
		btn.addEventListener("click", () => {
			pushUndo();
			edge.type = type;
			saveState();
			renderAll();
		});
		btnRow.appendChild(btn);
	}
	s.appendChild(btnRow);
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
		const c = el("span", "pc-count");
		c.textContent = `${homeCount}`;
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

function cssToHex(color) {
	const ctx = document.createElement("canvas").getContext("2d");
	ctx.fillStyle = color;
	return ctx.fillStyle; // always normalises to #rrggbb
}

function openPowerEditor(p) {
	const bg = el("div", "modal-bg");
	const m = el("div", "modal");
	m.innerHTML = `
    <h2>Edit power</h2>
    <div class="field"><label>Name</label><input type="text" id="pe-name" value="${escapeHtml(p.name)}"></div>
    <div class="field">
      <label>Color</label>
      <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
        <input type="color" id="pe-color-pick" value="${escapeHtml(cssToHex(p.color))}">
        <input type="text" id="pe-color" value="${escapeHtml(p.color)}" style="flex:1">
      </div>
    </div>
    <div class="actions">
      <button class="toolbtn danger" id="pe-del">Delete power</button>
      <div class="spacer" style="flex:1"></div>
      <button class="toolbtn" id="pe-cancel">Cancel</button>
      <button class="toolbtn" id="pe-save" style="background:var(--ink);color:var(--paper)">Save</button>
    </div>
  `;
	bg.appendChild(m);
	document.body.appendChild(bg);

	const pick = m.querySelector("#pe-color-pick");
	const txt  = m.querySelector("#pe-color");

	pick.addEventListener("input", () => { txt.value = pick.value; });
	txt.addEventListener("input", () => {
		const hex = cssToHex(txt.value);
		if (hex !== "#000000" || txt.value.trim() === "#000000") pick.value = hex;
	});

	m.querySelector("#pe-name").focus();
	m.querySelector("#pe-cancel").onclick = () => bg.remove();
	bg.onclick = (ev) => { if (ev.target === bg) bg.remove(); };

	m.querySelector("#pe-save").onclick = () => {
		pushUndo();
		p.name = m.querySelector("#pe-name").value || p.name;
		p.color = txt.value || p.color;
		saveState();
		bg.remove();
		renderAll();
	};
	m.querySelector("#pe-del").onclick = () => {
		if (!confirm(`Delete power ${p.name}? Territories owned by it become neutral.`))
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
	// Edge type consistency
	for (const e of state.edges) {
		const a = state.territories[e.a], b = state.territories[e.b];
		if (!a || !b) {
			issues.push({ sev: "err", msg: `Dangling edge ${e.a}↔${e.b}` });
			continue;
		}
		const type = e.type || "both";
		const na = a.name || a.id, nb = b.name || b.id;
		// Army edge: neither endpoint should be sea
		if (type === "army" || type === "both") {
			if (a.type === "sea")
				issues.push({ sev: "warn", msg: `"${na}" is sea but has army edge to "${nb}"` });
			if (b.type === "sea")
				issues.push({ sev: "warn", msg: `"${nb}" is sea but has army edge to "${na}"` });
		}
		// Fleet edge: neither endpoint should be land
		if (type === "fleet" || type === "both") {
			if (a.type === "land")
				issues.push({ sev: "warn", msg: `"${na}" is land but has fleet edge to "${nb}"` });
			if (b.type === "land")
				issues.push({ sev: "warn", msg: `"${nb}" is land but has fleet edge to "${na}"` });
		}
		// Inferred type mismatch (skip coast-coast: genuinely ambiguous)
		if (!(a.type === "coast" && b.type === "coast")) {
			const inferred = inferEdgeType(e.a, e.b);
			if (inferred !== type) {
				issues.push({ sev: "info", msg: `"${na}" ↔ "${nb}": type is ${type}, inferred ${inferred}` });
			}
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
let _edgeSweepActive = false;
let _edgeSweepStart = null; // image coords of last processed point (advances each move)
let _edgeSweepOrigin = null; // image coords where sweep began (for visual)
let _edgeSweepDidRemove = false;

const wrap = () => document.getElementById("canvas-wrap");

function onMouseMove(e) {
	if (state.mode === "graph") { onGraphMouseMove(e); return; }
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
	if (state.mode === "adjacencies" && state.pendingEdge) {
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
		if (state.mode === "adjacencies" && !state.pendingEdge) {
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
	if (state.mode === "graph") { onGraphMouseUp(e); return; }
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
		};
		state.selectedTerritory = id;
		saveState();
		renderAll();
	} else if (state.mode === "adjacencies") {
		if (state.pendingEdge) {
			state.pendingEdge = null;
			renderAll();
		}
	}
}

function inferEdgeType(idA, idB) {
	const a = state.territories[idA], b = state.territories[idB];
	if (!a || !b) return "both";
	const ta = a.type, tb = b.type;
	if (ta === "land" && tb === "land") return "army";
	if (ta === "sea"  && tb === "sea")  return "fleet";
	if ((ta === "sea" && tb === "land") || (ta === "land" && tb === "sea")) return "army";
	if ((ta === "sea" && tb === "coast") || (ta === "coast" && tb === "sea")) return "fleet";
	if ((ta === "land" && tb === "coast") || (ta === "coast" && tb === "land")) return "army";
	return "both"; // coast–coast
}

function addEdge(a, b) {
	if (a === b) return;
	if (a > b) { const t = a; a = b; b = t; }
	if (state.edges.some((e) => e.a === a && e.b === b)) return;
	pushUndo();
	state.edges.push({ a, b, type: inferEdgeType(a, b) });
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
	else if (e.key === "4") setMode("graph");
	else if (e.key === "Escape") {
		state.pendingEdge = null;
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
	}
}

function onKeyUp(e) {
	if (e.key === " ") {
		_spaceHeld = false;
		wrap().classList.remove("pan-ready");
	}
}

// =============================================================================
// EXPORT / IMPORT
// =============================================================================

function buildExportBlob() {
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
			home_supply_centers: homes,
		};
	}

	const territories = {};
	// Build edge lookup keyed by id pair for fast type retrieval
	const edgeTypeOf = {};
	for (const e of state.edges) {
		edgeTypeOf[`${e.a}|${e.b}`] = e.type || "both";
	}
	const adjByT = {};
	for (const e of state.edges) {
		(adjByT[e.a] ||= []).push(e.b);
		(adjByT[e.b] ||= []).push(e.a);
	}
	const sortedTs = Object.values(state.territories).sort((a, b) =>
		(a.name || a.id).localeCompare(b.name || b.id),
	);
	for (const t of sortedTs) {
		const adjObj = {};
		const neighbors = (adjByT[t.id] || [])
			.map((nid) => state.territories[nid])
			.filter(Boolean)
			.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
		for (const n of neighbors) {
			const key = t.id < n.id ? `${t.id}|${n.id}` : `${n.id}|${t.id}`;
			adjObj[ref(n)] = edgeTypeOf[key] || "both";
		}
		const ownerName = state.powers.find((p) => p.id === t.owner)?.name || null;
		territories[ref(t)] = {
			type: t.type,
			supply_center: !!t.sc,
			owner: ownerName,
			adjacent: adjObj,
			_pos: { x: Math.round(t.x), y: Math.round(t.y) },
		};
	}

	const graphNodesByName = {};
	for (const id in graphNodes) {
		const t = state.territories[id];
		const name = t && (t.name || t.id);
		if (name) {
			const n = graphNodes[id];
			graphNodesByName[name] = { x: Math.round(n.x), y: Math.round(n.y), anchored: n.anchored };
		}
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
		_graph: {
			tension_factor: graphTensionFactor,
			repulsion_factor: graphRepulsionFactor,
			nodes: graphNodesByName,
		},
	};

	return new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
}

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateExportBtn() {
	const btn = document.getElementById("btn-export");
	btn.textContent = jsonFileHandle ? `Save JSON ↓` : "Export JSON ↓";
	btn.title = jsonFileHandle ? `Saving to: ${jsonFileHandle.name}` : "";
}

async function exportJSON() {
	const blob = buildExportBlob();

	// Already have a handle — write in place.
	if (jsonFileHandle) {
		try {
			const writable = await jsonFileHandle.createWritable();
			await writable.write(blob);
			await writable.close();
			flashSaved(`✓ saved to ${jsonFileHandle.name}`, 2000);
			return;
		} catch {
			// Permission revoked or file gone — fall through to picker.
			jsonFileHandle = null;
			updateExportBtn();
		}
	}

	if (FSA_SUPPORTED) {
		try {
			jsonFileHandle = await window.showSaveFilePicker({
				suggestedName: "diplo_map_extraction.json",
				types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
			});
			updateExportBtn();
			const writable = await jsonFileHandle.createWritable();
			await writable.write(blob);
			await writable.close();
			flashSaved(`✓ saved to ${jsonFileHandle.name}`, 2000);
		} catch (e) {
			if (e.name !== "AbortError") alert("Save failed: " + e.message);
		}
	} else {
		downloadBlob(blob, "diplo_map_extraction.json");
		flashSaved("✓ exported", 2000);
	}
}

function importJSON(obj) {
	// Be permissive: accept our own export format, or raw {territories, edges, powers}.
	if (!confirm("Importing will replace the current extraction. Proceed?"))
		return false;
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
			};
		}
		nextTerritoryId = next;
		// Edges from adjacency map (new: object with types) or array (legacy)
		const seen = new Set();
		for (const tname in obj.territories) {
			const td = obj.territories[tname];
			const a = nameToId[tname];
			const adjRaw = td.adjacent || {};
			// Support both {name: type} object and legacy [name] array
			const entries = Array.isArray(adjRaw)
				? adjRaw.map((n) => [n, "both"])
				: Object.entries(adjRaw);
			for (const [nname, etype] of entries) {
				const b = nameToId[nname];
				if (!b || !a) continue;
				const key = a < b ? `${a}|${b}` : `${b}|${a}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const type = ["army", "fleet", "both"].includes(etype) ? etype : "both";
				state.edges.push(a < b ? { a, b, type } : { a: b, b: a, type });
			}
		}
		// Restore graph view state if present
		for (const id in graphNodes) delete graphNodes[id];
		if (obj._graph) {
			graphTensionFactor = obj._graph.tension_factor ?? 0.5;
			graphRepulsionFactor = obj._graph.repulsion_factor ?? 0.32;
			for (const tname in (obj._graph.nodes || {})) {
				const id = nameToId[tname];
				if (!id) continue;
				const nd = obj._graph.nodes[tname];
				graphNodes[id] = { x: nd.x, y: nd.y, vx: 0, vy: 0, pinned: false, anchored: !!nd.anchored };
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
// GRAPH VIEW — force-directed layout
// =============================================================================

const graphNodes = {}; // id -> {x, y, vx, vy, pinned, anchored}
const graphSim = { running: false, animId: null };
const graphViewport = { tx: 0, ty: 0, scale: 1 };
let graphDrag = null; // {id, x0, y0} while dragging a node
let graphPan = null;  // {startX, startY, startTx, startTy} while panning background
let graphRestLen = 75;          // updated from avg edge dist on each layout init
let graphTensionFactor = 0.5;   // multiplier applied to avg edge dist → rest length
let graphRepulsionFactor = 0.32; // scales the node-node repulsion constant
let graphShowDegree = false;

function abbrev(name) {
	if (!name || !name.trim()) return "?";
	const words = name.trim().split(/\s+/);
	if (words.length === 1) return name.length <= 5 ? name : name.slice(0, 4);
	return words.map((w) => w[0].toUpperCase()).join("");
}

function syncGraphNodes(randomize) {
	const tArr = Object.values(state.territories);
	const cx = tArr.reduce((s, t) => s + t.x, 0) / (tArr.length || 1);
	const cy = tArr.reduce((s, t) => s + t.y, 0) / (tArr.length || 1);

	for (const id in state.territories) {
		if (!graphNodes[id] || randomize) {
			const t = state.territories[id];
			graphNodes[id] = {
				x: t.x - cx,
				y: t.y - cy,
				vx: 0,
				vy: 0,
				pinned: false,
				anchored: false,
			};
		}
	}
	for (const id in graphNodes) {
		if (!state.territories[id]) delete graphNodes[id];
	}
}

function computeAvgEdgeDist() {
	let total = 0, count = 0;
	for (const e of state.edges) {
		const a = state.territories[e.a], b = state.territories[e.b];
		if (!a || !b) continue;
		const dx = a.x - b.x, dy = a.y - b.y;
		total += Math.sqrt(dx * dx + dy * dy);
		count++;
	}
	return count > 0 ? total / count : 150;
}

function findOuterRing() {
	const ids = Object.keys(graphNodes);
	if (ids.length < 3) return ids.slice();

	// Build adjacency from current edges
	const adj = {};
	for (const id of ids) adj[id] = [];
	for (const e of state.edges) {
		if (graphNodes[e.a] && graphNodes[e.b]) {
			adj[e.a].push(e.b);
			adj[e.b].push(e.a);
		}
	}

	const pt = (id) => graphNodes[id];
	const ang = (from, to) =>
		Math.atan2(pt(to).y - pt(from).y, pt(to).x - pt(from).x);

	// Leftmost node is guaranteed on the outer face
	const start = ids.reduce((best, id) =>
		pt(id).x < pt(best).x ? id : best, ids[0]);

	const ring = [];
	let cur = start, prevId = null;

	for (let guard = 0; guard <= ids.length + 2; guard++) {
		ring.push(cur);
		const neighbors = adj[cur];
		if (!neighbors.length) break;

		// Angle back toward where we came from (virtual "below" for first step)
		const backAngle = prevId === null ? Math.PI / 2 : ang(cur, prevId);

		// Pick the neighbor with the smallest clockwise offset from backAngle.
		// This traces the outer face of the planar embedding (right-hand rule).
		let best = null, bestOffset = Infinity;
		for (const nid of neighbors) {
			let offset = (ang(cur, nid) - backAngle + Math.PI * 2) % (Math.PI * 2);
			if (offset < 1e-9) offset = Math.PI * 2; // don't reverse
			if (offset < bestOffset) { bestOffset = offset; best = nid; }
		}

		if (!best || (best === start && ring.length > 2)) break;
		prevId = cur;
		cur = best;
	}

	return ring; // ordered array forming a connected cycle
}

function pinHullNodes() {
	const ring = findOuterRing();

	for (const id in graphNodes) graphNodes[id].anchored = false;
	for (const id of ring) graphNodes[id].anchored = true;

	// Project every ring node onto a circle at its current geographic angle.
	// Radius = max distance of any ring node from the centroid (origin in graph-space).
	let maxR = 0;
	for (const id of ring) {
		const n = graphNodes[id];
		maxR = Math.max(maxR, Math.sqrt(n.x * n.x + n.y * n.y));
	}
	if (maxR < 1) maxR = 200;

	const startAngle = Math.atan2(graphNodes[ring[0]].y, graphNodes[ring[0]].x);
	const step = (Math.PI * 2) / ring.length;
	for (let i = 0; i < ring.length; i++) {
		const n = graphNodes[ring[i]];
		n.x = maxR * Math.cos(startAngle + i * step);
		n.y = maxR * Math.sin(startAngle + i * step);
		n.vx = 0;
		n.vy = 0;
	}
}

function fitGraphToScreen() {
	const svg = document.getElementById("graph-svg");
	if (!svg) return;
	const w = svg.clientWidth || 800, h = svg.clientHeight || 600;
	const ids = Object.keys(graphNodes);
	if (!ids.length) { graphViewport.tx = w / 2; graphViewport.ty = h / 2; graphViewport.scale = 1; return; }

	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const id of ids) {
		minX = Math.min(minX, graphNodes[id].x);
		maxX = Math.max(maxX, graphNodes[id].x);
		minY = Math.min(minY, graphNodes[id].y);
		maxY = Math.max(maxY, graphNodes[id].y);
	}
	const pad = 60;
	const scaleX = (w - pad * 2) / (maxX - minX || 1);
	const scaleY = (h - pad * 2) / (maxY - minY || 1);
	graphViewport.scale = Math.min(scaleX, scaleY, 2);
	graphViewport.tx = w / 2 - ((minX + maxX) / 2) * graphViewport.scale;
	graphViewport.ty = h / 2 - ((minY + maxY) / 2) * graphViewport.scale;
}

function graphTick() {
	const ids = Object.keys(graphNodes);
	const REST_LEN = graphRestLen;
	const REPULSION = graphRepulsionFactor * REST_LEN * REST_LEN;
	const SPRING_K = 0.045;
	const DAMP = 0.82;
	const GRAVITY = 0.004;
	const MAX_V = 0.12 * REST_LEN;

	// Reset force accumulators
	for (const id of ids) {
		graphNodes[id].fx = 0;
		graphNodes[id].fy = 0;
	}

	// Pairwise repulsion
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const a = graphNodes[ids[i]], b = graphNodes[ids[j]];
			const dx = a.x - b.x, dy = a.y - b.y;
			const d2 = Math.max(dx * dx + dy * dy, 400);
			const d = Math.sqrt(d2);
			const f = REPULSION / d2;
			const fx = (f * dx) / d, fy = (f * dy) / d;
			a.fx += fx; a.fy += fy;
			b.fx -= fx; b.fy -= fy;
		}
	}

	// Spring attraction along edges
	for (const e of state.edges) {
		const a = graphNodes[e.a], b = graphNodes[e.b];
		if (!a || !b) continue;
		const dx = b.x - a.x, dy = b.y - a.y;
		const d = Math.sqrt(dx * dx + dy * dy) || 1;
		const f = SPRING_K * (d - REST_LEN);
		const fx = (f * dx) / d, fy = (f * dy) / d;
		a.fx += fx; a.fy += fy;
		b.fx -= fx; b.fy -= fy;
	}

	// Integrate (center gravity + damping + velocity clamp)
	for (const id of ids) {
		const n = graphNodes[id];
		if (n.pinned || n.anchored) continue;
		n.vx = (n.vx + n.fx - n.x * GRAVITY) * DAMP;
		n.vy = (n.vy + n.fy - n.y * GRAVITY) * DAMP;
		const v = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
		if (v > MAX_V) { n.vx = (n.vx / v) * MAX_V; n.vy = (n.vy / v) * MAX_V; }
		n.x += n.vx;
		n.y += n.vy;
	}

	renderGraph();
	if (graphSim.running) graphSim.animId = requestAnimationFrame(graphTick);
}

function startGraphSim() {
	if (graphSim.running) return;
	graphSim.running = true;
	document.getElementById("graph-view").classList.remove("graph-sim-paused");
	graphSim.animId = requestAnimationFrame(graphTick);
}

function stopGraphSim() {
	graphSim.running = false;
	if (graphSim.animId) { cancelAnimationFrame(graphSim.animId); graphSim.animId = null; }
	document.getElementById("graph-view").classList.add("graph-sim-paused");
	saveState();
}

// Blue (#3b82f6) → Yellow (#facc15) → Red (#ef4444)
function degreeGradientColor(t) {
	const stops = [[59,130,246], [250,204,21], [239,68,68]];
	const s = t * (stops.length - 1);
	const i = Math.min(Math.floor(s), stops.length - 2);
	const f = s - i;
	const [r1,g1,b1] = stops[i], [r2,g2,b2] = stops[i + 1];
	return `rgb(${Math.round(r1+(r2-r1)*f)},${Math.round(g1+(g2-g1)*f)},${Math.round(b1+(b2-b1)*f)})`;
}

function renderGraph() {
	const svg = document.getElementById("graph-svg");
	if (!svg) return;
	const w = svg.clientWidth || 800, h = svg.clientHeight || 600;

	while (svg.firstChild) svg.removeChild(svg.firstChild);

	const root = document.createElementNS("http://www.w3.org/2000/svg", "g");
	const { tx, ty, scale } = graphViewport;
	const isc = 1 / scale;
	root.setAttribute("transform", `translate(${tx},${ty}) scale(${scale})`);

	// Edges
	for (const e of state.edges) {
		const a = graphNodes[e.a], b = graphNodes[e.b];
		if (!a || !b) continue;
		const type = e.type || "both";
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
		line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
		line.setAttribute("class", "gedge");
		line.setAttribute("stroke-width", 2.5 * isc);
		if (type === "army") {
			line.setAttribute("stroke", "#a06030");
			line.setAttribute("stroke-dasharray", `${6 * isc} ${4 * isc}`);
		} else if (type === "fleet") {
			line.setAttribute("stroke", "#2060b0");
			line.setAttribute("stroke-dasharray", `${2 * isc} ${3 * isc}`);
		} else {
			line.setAttribute("stroke", "#333");
		}
		line.setAttribute("opacity", "0.7");
		root.appendChild(line);
	}

	// Degree map (used when overlay is active)
	const degreeMap = {};
	let degMin = Infinity, degMax = -Infinity;
	if (graphShowDegree) {
		for (const id in graphNodes) degreeMap[id] = 0;
		for (const e of state.edges) {
			if (degreeMap[e.a] !== undefined) degreeMap[e.a]++;
			if (degreeMap[e.b] !== undefined) degreeMap[e.b]++;
		}
		for (const id in degreeMap) {
			if (degreeMap[id] < degMin) degMin = degreeMap[id];
			if (degreeMap[id] > degMax) degMax = degreeMap[id];
		}
	}

	// Nodes — node shapes stay fixed screen-size via counter-scale
	for (const id in graphNodes) {
		const t = state.territories[id];
		if (!t) continue;
		const n = graphNodes[id];
		const R = 13 * isc;
		const typeColor = t.type === "sea" ? "var(--accent-2)" : "var(--rule)";
		const ownerColor = getOwnerColor(t.owner);
		const isOwned = t.owner && t.owner !== "neutral";

		const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
		g.setAttribute("class", "gnode" +
			(n.anchored ? " anchored" : "") +
			(graphDrag && graphDrag.id === id ? " dragging" : ""));
		g.setAttribute("transform", `translate(${n.x},${n.y})`);
		g.dataset.id = id;

		// Invisible hit area
		const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		hit.setAttribute("r", 26 * isc); hit.setAttribute("class", "gn-hit");
		g.appendChild(hit);

		// Type-based shape
		let shape;
		if (t.type === "sea") {
			shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
			shape.setAttribute("points", `0,${-R * 1.3} ${R * 1.3},0 0,${R * 1.3} ${-R * 1.3},0`);
		} else if (t.type === "land") {
			shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
			shape.setAttribute("x", -R); shape.setAttribute("y", -R);
			shape.setAttribute("width", R * 2); shape.setAttribute("height", R * 2);
		} else {
			shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			shape.setAttribute("r", R);
		}
		shape.setAttribute("class", "gn-dot");
		if (graphShowDegree) {
			const td = degMax > degMin
				? (degreeMap[id] - degMin) / (degMax - degMin)
				: 0.5;
			shape.setAttribute("fill", degreeGradientColor(td));
			shape.setAttribute("stroke", "#2228");
			shape.setAttribute("stroke-width", 2.0 * isc);
		} else {
			shape.setAttribute("fill", typeColor);
			shape.setAttribute("stroke", isOwned ? ownerColor : "#444");
			shape.setAttribute("stroke-width", (isOwned ? 4.5 : 2.0) * isc);
		}
		g.appendChild(shape);

		// SC indicator — paper-coloured separator ring + owner-coloured inner dot
		if (t.sc && !graphShowDegree) {
			const sep = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			sep.setAttribute("r", R * 0.58);
			sep.setAttribute("fill", "var(--paper)");
			sep.setAttribute("stroke", "none");
			sep.setAttribute("pointer-events", "none");
			g.appendChild(sep);

			const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			dot.setAttribute("class", "gn-sc-dot");
			dot.setAttribute("r", R * 0.46);
			dot.setAttribute("fill", ownerColor);
			dot.setAttribute("stroke", "#0003");
			dot.setAttribute("stroke-width", 0.8 * isc);
			g.appendChild(dot);
		}

		// Anchor ring for pinned hull nodes
		if (n.anchored) {
			const ar = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			ar.setAttribute("class", "gn-anchor-ring");
			ar.setAttribute("r", R * 2.2);
			ar.setAttribute("stroke-width", 1.2 * isc);
			ar.setAttribute("stroke-dasharray", `${3.5 * isc} ${2.5 * isc}`);
			g.appendChild(ar);
		}

		// Label below node
		const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
		label.setAttribute("class", "gn-label");
		label.setAttribute("y", R + 18 * isc);
		label.setAttribute("font-size", 14 * isc);
		label.textContent = t.name || t.id;
		g.appendChild(label);

		// Degree overlay
		if (graphShowDegree) {
			const deg = document.createElementNS("http://www.w3.org/2000/svg", "text");
			deg.setAttribute("class", "gn-degree");
			deg.setAttribute("y", R * 0.38);
			deg.setAttribute("font-size", 11 * isc);
			deg.setAttribute("stroke-width", 3 * isc);
			deg.textContent = degreeMap[id] ?? 0;
			g.appendChild(deg);
		}

		root.appendChild(g);
	}

	svg.appendChild(root);
}

function svgToGraph(clientX, clientY) {
	const svg = document.getElementById("graph-svg");
	const rect = svg.getBoundingClientRect();
	return {
		x: (clientX - rect.left - graphViewport.tx) / graphViewport.scale,
		y: (clientY - rect.top  - graphViewport.ty) / graphViewport.scale,
	};
}

function onGraphMouseDown(e) {
	if (e.button !== 0) return;
	e.preventDefault();
	const g = e.target.closest(".gnode");
	if (g) {
		const id = g.dataset.id;
		if (!id || !graphNodes[id]) return;
		e.stopPropagation();
		graphDrag = { id, x0: graphNodes[id].x, y0: graphNodes[id].y };
		graphNodes[id].pinned = true;
		graphNodes[id].vx = 0;
		graphNodes[id].vy = 0;
	} else {
		graphPan = { startX: e.clientX, startY: e.clientY, startTx: graphViewport.tx, startTy: graphViewport.ty };
		document.getElementById("graph-svg").classList.add("panning");
	}
	if (!graphSim.running) renderGraph();
}

function onGraphMouseMove(e) {
	if (graphDrag) {
		const n = graphNodes[graphDrag.id];
		if (!n) return;
		const pos = svgToGraph(e.clientX, e.clientY);
		n.x = pos.x;
		n.y = pos.y;
		if (!graphSim.running) renderGraph();
	} else if (graphPan) {
		graphViewport.tx = graphPan.startTx + (e.clientX - graphPan.startX);
		graphViewport.ty = graphPan.startTy + (e.clientY - graphPan.startY);
		if (!graphSim.running) renderGraph();
	}
}

function onGraphMouseUp() {
	if (graphDrag) {
		const n = graphNodes[graphDrag.id];
		if (n) {
			const dx = n.x - graphDrag.x0, dy = n.y - graphDrag.y0;
			if (dx * dx + dy * dy < 16 / (graphViewport.scale * graphViewport.scale))
				n.anchored = !n.anchored; // click → toggle
			n.pinned = false;
			n.vx = 0;
			n.vy = 0;
		}
		graphDrag = null;
		saveState();
	}
	if (graphPan) {
		graphPan = null;
		document.getElementById("graph-svg").classList.remove("panning");
	}
	if (!graphSim.running) renderGraph();
}

function onGraphWheel(e) {
	e.preventDefault();
	const svg = document.getElementById("graph-svg");
	const rect = svg.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;
	const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
	const newScale = Math.max(0.08, Math.min(8, graphViewport.scale * factor));
	graphViewport.tx = mx - (mx - graphViewport.tx) * (newScale / graphViewport.scale);
	graphViewport.ty = my - (my - graphViewport.ty) * (newScale / graphViewport.scale);
	graphViewport.scale = newScale;
	if (!graphSim.running) renderGraph();
}

function sectionGraphControls() {
	const s = el("div", "sb-section");
	s.appendChild(el("h3", null, "Graph View"));

	const desc = el("div", "hint", "Outer hull nodes are anchored (dashed ring). Click any node to toggle. Drag to move.");
	desc.style.marginBottom = "14px";
	s.appendChild(desc);

	const btnReset = el("button", "toolbtn");
	btnReset.textContent = "Reset Layout";
	btnReset.style.cssText = "width:100%; margin-bottom:6px; display:block;";
	btnReset.onclick = () => {
		syncGraphNodes(true);
		graphRestLen = computeAvgEdgeDist() * graphTensionFactor;
		pinHullNodes();
		fitGraphToScreen();
		if (!graphSim.running) startGraphSim();
		else renderGraph();
		renderSidebar();
	};
	s.appendChild(btnReset);

	const btnPause = el("button", "toolbtn");
	btnPause.textContent = graphSim.running ? "Pause Simulation" : "Resume Simulation";
	btnPause.style.cssText = "width:100%; display:block;";
	btnPause.onclick = () => {
		if (graphSim.running) stopGraphSim();
		else startGraphSim();
		btnPause.textContent = graphSim.running ? "Pause Simulation" : "Resume Simulation";
	};
	s.appendChild(btnPause);

	const sliderWrap = el("div", "field");
	sliderWrap.style.marginTop = "14px";
	const sliderHeader = el("div");
	sliderHeader.style.cssText = "display:flex; justify-content:space-between; margin-bottom:4px;";
	sliderHeader.appendChild(el("label", null, "Spring length"));
	const sliderVal = el("span", "hint");
	sliderVal.textContent = graphTensionFactor.toFixed(2) + "×";
	sliderHeader.appendChild(sliderVal);
	sliderWrap.appendChild(sliderHeader);
	const slider = el("input");
	slider.type = "range";
	slider.min = "0.1";
	slider.max = "1.5";
	slider.step = "0.05";
	slider.value = graphTensionFactor;
	slider.style.width = "100%";
	slider.addEventListener("input", () => {
		graphTensionFactor = parseFloat(slider.value);
		sliderVal.textContent = graphTensionFactor.toFixed(2) + "×";
		graphRestLen = computeAvgEdgeDist() * graphTensionFactor;
		saveState();
	});
	sliderWrap.appendChild(slider);
	s.appendChild(sliderWrap);

	const repWrap = el("div", "field");
	repWrap.style.marginTop = "10px";
	const repHeader = el("div");
	repHeader.style.cssText = "display:flex; justify-content:space-between; margin-bottom:4px;";
	repHeader.appendChild(el("label", null, "Repulsion"));
	const repVal = el("span", "hint");
	repVal.textContent = graphRepulsionFactor.toFixed(2) + "×";
	repHeader.appendChild(repVal);
	repWrap.appendChild(repHeader);
	const repSlider = el("input");
	repSlider.type = "range";
	repSlider.min = "0.05";
	repSlider.max = "2.0";
	repSlider.step = "0.05";
	repSlider.value = graphRepulsionFactor;
	repSlider.style.width = "100%";
	repSlider.addEventListener("input", () => {
		graphRepulsionFactor = parseFloat(repSlider.value);
		repVal.textContent = graphRepulsionFactor.toFixed(2) + "×";
		saveState();
	});
	repWrap.appendChild(repSlider);
	s.appendChild(repWrap);

	const nT = Object.keys(state.territories).length;
	const nE = state.edges.length;
	const stats = el("div", "hint", `${nT} nodes · ${nE} edges`);
	stats.style.marginTop = "10px";
	s.appendChild(stats);

	const degRow = el("div");
	degRow.style.cssText = "display:flex; align-items:center; gap:6px; margin-top:12px;";
	const degChk = el("input");
	degChk.type = "checkbox";
	degChk.id = "chk-degree";
	degChk.checked = graphShowDegree;
	degChk.addEventListener("change", () => {
		graphShowDegree = degChk.checked;
		renderGraph();
	});
	const degLbl = el("label", null, "Show adjacency count");
	degLbl.setAttribute("for", "chk-degree");
	degLbl.style.cursor = "pointer";
	degRow.appendChild(degChk);
	degRow.appendChild(degLbl);
	s.appendChild(degRow);

	return s;
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
	if (FSA_SUPPORTED) {
		document.getElementById("btn-import").onclick = async () => {
			try {
				const [handle] = await window.showOpenFilePicker({
					types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
				});
				const file = await handle.getFile();
				const obj = JSON.parse(await file.text());
				if (importJSON(obj) !== false) {
					jsonFileHandle = handle;
					updateExportBtn();
				}
			} catch (e) {
				if (e.name !== "AbortError") alert("Open failed: " + e.message);
			}
		};
	} else {
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
	}
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
	document.getElementById("graph-svg").addEventListener("mousedown", onGraphMouseDown);
	document.getElementById("graph-svg").addEventListener("wheel", onGraphWheel, { passive: false });
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);
	window.addEventListener("beforeunload", saveState);

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
      <tr><td style="padding:2px 10px 2px 0"><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> / <kbd>4</kbd></td><td>Mode: Terr / Adj / Own / Graph</td></tr>
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
      <tr><td><kbd>Esc</kbd></td><td>Cancel pending edge</td></tr>
      <tr><td colspan="2" style="padding-top:10px; font-weight:600">Ownership mode</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Select power (via list order)</td></tr>
      <tr><td><kbd>0</kbd></td><td>Deselect power</td></tr>
    </table>
  `;
	document.body.appendChild(h);
	h.querySelector(".close").onclick = () => h.remove();
}

init();
