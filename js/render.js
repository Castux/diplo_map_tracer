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
	el.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${scale})`;
	document.getElementById("sb-zoom").textContent = Math.round(scale * 100) + "%";
	document.documentElement.style.setProperty("--marker-r", 8 / scale + "px");
	renderOverlay();
}

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
	while (svg.firstChild) svg.removeChild(svg.firstChild);

	const inverseScale = 1 / state.viewport.scale;

	// Parent-child links
	for (const id in state.territories) {
		const t = state.territories[id];
		const parent = getParent(t);
		if (!parent) continue;
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", parent.x); line.setAttribute("y1", parent.y);
		line.setAttribute("x2", t.x); line.setAttribute("y2", t.y);
		line.setAttribute("class", "edge-parent");
		line.setAttribute("stroke-width", 1.5 * inverseScale);
		line.setAttribute("stroke-dasharray", `${3 * inverseScale} ${3 * inverseScale}`);
		svg.appendChild(line);
	}

	// Edges
	for (const e of state.edges) {
		const a = state.territories[e.a], b = state.territories[e.b];
		if (!a || !b) continue;
		const edgeType = e.type || "both";
		const isSelected = state.selectedEdge &&
			state.selectedEdge.a === e.a && state.selectedEdge.b === e.b;

		const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
		hit.setAttribute("x1", a.x); hit.setAttribute("y1", a.y);
		hit.setAttribute("x2", b.x); hit.setAttribute("y2", b.y);
		hit.setAttribute("stroke", "rgba(0,0,0,0.01)");
		hit.setAttribute("stroke-width", 12 * inverseScale);
		hit.setAttribute("class", "edge-hit");
		hit.dataset.a = e.a; hit.dataset.b = e.b;
		hit.addEventListener("mousedown", (ev) => {
			if (state.mode !== "adjacencies") return;
			ev.stopPropagation();
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
			const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
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

		const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		halo.setAttribute("class", "m-halo");
		halo.setAttribute("r", 15 * inverseScale);
		halo.setAttribute("stroke-width", 2.5 * inverseScale);
		g.appendChild(halo);

		const r = 8 * inverseScale;
		const parent = getParent(t);
		const color = getOwnerColor((parent || t).owner);
		let shape;
		if (t.type === "sea") {
			shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
			shape.setAttribute(
				"points",
				`0,${-r * 1.2} ${r * 1.2},0 0,${r * 1.2} ${-r * 1.2},0`,
			);
		} else if (t.type === "land") {
			shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
			shape.setAttribute("x", -r);
			shape.setAttribute("y", -r);
			shape.setAttribute("width", r * 2);
			shape.setAttribute("height", r * 2);
		} else {
			shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			shape.setAttribute("r", r);
		}
		shape.setAttribute("class", "m-dot");
		shape.setAttribute("fill", color);
		shape.setAttribute("stroke-width", 2.0 * inverseScale);
		g.appendChild(shape);

		if (t.sc && !parent) {
			const isHome = t.owner && t.owner !== "neutral";
			const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			ring.setAttribute("class", "sc-indicator" + (isHome ? " home" : ""));
			ring.setAttribute("r", r * 1.9);
			ring.setAttribute("stroke-width", (isHome ? 2.8 : 1.8) * inverseScale);
			g.appendChild(ring);
		}

		const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
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
		(t) => !isSubprovince(t) && t.sc && t.owner && t.owner !== "neutral",
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
