// =============================================================================
// GRAPH VIEW — force-directed layout
// =============================================================================

const graphNodes = {}; // id -> {x, y, z, vx, vy, vz, pinned, anchored}
const graphSim = { running: false, animId: null };
const graphViewport = { tx: 0, ty: 0, scale: 1 };
let graphDrag = null;
let graphPan = null;
let graph3DOrbit = null;
let graphRestLen = 75;
let graphTensionFactor = 0.5;
let graphRepulsionFactor = 0.32;
let graphAttractionFactor = 1.0;
let graphShowDegree = false;
let graph3DMode = false;
const graph3DCamera = { rx: 0.4, ry: 0.6 };
const graphNodes2DSave = {}; // persists 2D layout while 3D is active
const graphNodes3DSave = {}; // persists 3D layout while 2D is active

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
				z: graph3DMode ? (Math.random() - 0.5) * 30 : 0,
				vx: 0, vy: 0, vz: 0,
				pinned: false,
				anchored: false,
			};
		} else if (!('z' in graphNodes[id])) {
			graphNodes[id].z = 0;
			graphNodes[id].vz = 0;
		}
	}
	for (const id in graphNodes) {
		if (!state.territories[id]) delete graphNodes[id];
	}
}

function saveNodesToStore(store) {
	for (const id in store) delete store[id];
	for (const id in graphNodes) store[id] = { ...graphNodes[id] };
}

function restoreNodesFromStore(store) {
	for (const id in graphNodes) delete graphNodes[id];
	for (const id in store) {
		if (state.territories[id]) graphNodes[id] = { ...store[id] };
	}
	syncGraphNodes(false); // fill in any territories added while in the other mode
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

// Perspective projection: yaw then pitch, then mild perspective divide
function project3D(x, y, z) {
	const { rx, ry } = graph3DCamera;
	const x1 = x * Math.cos(ry) + z * Math.sin(ry);
	const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
	const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
	const z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
	const FOV = 1200;
	const w = FOV / (FOV + z2);
	return { px: x1 * w, py: y2 * w, depth: z2, w };
}

function findOuterRing() {
	const ids = Object.keys(graphNodes).filter(id => {
		const t = state.territories[id];
		return !t || !isSubprovince(t);
	});
	if (ids.length < 3) return ids.slice();

	// Build name→id so we can resolve a subprovince to its parent id
	const nameToId = {};
	for (const id in state.territories) nameToId[state.territories[id].name] = id;
	const resolveId = (id) => {
		const t = state.territories[id];
		if (!t || !isSubprovince(t)) return id;
		const p = getParent(t);
		return p ? (nameToId[p.name] ?? id) : id;
	};

	const adj = {};
	for (const id of ids) adj[id] = [];
	for (const e of state.edges) {
		const a = resolveId(e.a), b = resolveId(e.b);
		if (adj[a] && adj[b] && a !== b) {
			if (!adj[a].includes(b)) adj[a].push(b);
			if (!adj[b].includes(a)) adj[b].push(a);
		}
	}

	const pt = (id) => graphNodes[id];
	const ang = (from, to) =>
		Math.atan2(pt(to).y - pt(from).y, pt(to).x - pt(from).x);

	const start = ids.reduce((best, id) =>
		pt(id).x < pt(best).x ? id : best, ids[0]);

	const ring = [];
	let cur = start, prevId = null;

	for (let guard = 0; guard <= ids.length + 2; guard++) {
		ring.push(cur);
		const neighbors = adj[cur];
		if (!neighbors.length) break;

		const backAngle = prevId === null ? Math.PI / 2 : ang(cur, prevId);

		let best = null, bestOffset = Infinity;
		for (const nid of neighbors) {
			let offset = (ang(cur, nid) - backAngle + Math.PI * 2) % (Math.PI * 2);
			if (offset < 1e-9) offset = Math.PI * 2;
			if (offset < bestOffset) { bestOffset = offset; best = nid; }
		}

		if (!best || (best === start && ring.length > 2)) break;
		prevId = cur;
		cur = best;
	}

	return ring;
}

function pinHullNodes() {
	const ring = findOuterRing();

	for (const id in graphNodes) graphNodes[id].anchored = false;
	for (const id of ring) graphNodes[id].anchored = true;

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
	if (!ids.length) {
		graphViewport.tx = w / 2;
		graphViewport.ty = h / 2;
		graphViewport.scale = 1;
		return;
	}

	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const id of ids) {
		const n = graphNodes[id];
		let px = n.x, py = n.y;
		if (graph3DMode) { const p = project3D(n.x, n.y, n.z || 0); px = p.px; py = p.py; }
		minX = Math.min(minX, px); maxX = Math.max(maxX, px);
		minY = Math.min(minY, py); maxY = Math.max(maxY, py);
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
	const SPRING_K = 0.045 * graphAttractionFactor;
	const DAMP = 0.82;
	const GRAVITY = 0.004;
	const MAX_V = 0.12 * REST_LEN;

	for (const id of ids) {
		graphNodes[id].fx = 0;
		graphNodes[id].fy = 0;
		if (graph3DMode) graphNodes[id].fz = 0;
	}

	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const a = graphNodes[ids[i]], b = graphNodes[ids[j]];
			const dx = a.x - b.x, dy = a.y - b.y;
			const dz = graph3DMode ? ((a.z || 0) - (b.z || 0)) : 0;
			const d2 = Math.max(dx * dx + dy * dy + dz * dz, 400);
			const d = Math.sqrt(d2);
			const f = REPULSION / d2;
			const fx = (f * dx) / d, fy = (f * dy) / d;
			a.fx += fx; a.fy += fy;
			b.fx -= fx; b.fy -= fy;
			if (graph3DMode) { const fz = (f * dz) / d; a.fz += fz; b.fz -= fz; }
		}
	}

	for (const e of state.edges) {
		const a = graphNodes[e.a], b = graphNodes[e.b];
		if (!a || !b) continue;
		const dx = b.x - a.x, dy = b.y - a.y;
		const dz = graph3DMode ? ((b.z || 0) - (a.z || 0)) : 0;
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
		const f = SPRING_K * (d - REST_LEN);
		const fx = (f * dx) / d, fy = (f * dy) / d;
		a.fx += fx; a.fy += fy;
		b.fx -= fx; b.fy -= fy;
		if (graph3DMode) { const fz = (f * dz) / d; a.fz += fz; b.fz -= fz; }
	}

	// Strong parent-child spring to keep subprovinces near parent
	const PARENT_K = 0.5;
	const PARENT_REST = 25;
	const tickNameToId = {};
	for (const id in state.territories) tickNameToId[state.territories[id].name] = id;
	for (const id of ids) {
		const t = state.territories[id];
		if (!t) continue;
		const parent = getParent(t);
		if (!parent) continue;
		const pid = tickNameToId[parent.name];
		const a = graphNodes[id], b = pid && graphNodes[pid];
		if (!a || !b) continue;
		const dx = b.x - a.x, dy = b.y - a.y;
		const dz = graph3DMode ? ((b.z || 0) - (a.z || 0)) : 0;
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
		const f = PARENT_K * (d - PARENT_REST);
		const fx = (f * dx) / d, fy = (f * dy) / d;
		a.fx += fx; a.fy += fy;
		b.fx -= fx; b.fy -= fy;
		if (graph3DMode) { const fz = (f * dz) / d; a.fz += fz; b.fz -= fz; }
	}

	for (const id of ids) {
		const n = graphNodes[id];
		if (n.pinned || n.anchored) continue;
		n.vx = (n.vx + n.fx - n.x * GRAVITY) * DAMP;
		n.vy = (n.vy + n.fy - n.y * GRAVITY) * DAMP;
		const v = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
		if (v > MAX_V) { n.vx = (n.vx / v) * MAX_V; n.vy = (n.vy / v) * MAX_V; }
		n.x += n.vx;
		n.y += n.vy;
		if (graph3DMode) {
			n.vz = ((n.vz || 0) + (n.fz || 0) - (n.z || 0) * GRAVITY) * DAMP;
			if (Math.abs(n.vz) > MAX_V) n.vz = Math.sign(n.vz) * MAX_V;
			n.z = (n.z || 0) + n.vz;
		}
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
	const stops = [[59, 130, 246], [250, 204, 21], [239, 68, 68]];
	const s = t * (stops.length - 1);
	const i = Math.min(Math.floor(s), stops.length - 2);
	const f = s - i;
	const [r1, g1, b1] = stops[i], [r2, g2, b2] = stops[i + 1];
	return `rgb(${Math.round(r1 + (r2 - r1) * f)},${Math.round(g1 + (g2 - g1) * f)},${Math.round(b1 + (b2 - b1) * f)})`;
}

function renderGraph() {
	const svg = document.getElementById("graph-svg");
	if (!svg) return;

	while (svg.firstChild) svg.removeChild(svg.firstChild);

	const root = document.createElementNS("http://www.w3.org/2000/svg", "g");
	const { tx, ty, scale } = graphViewport;
	const isc = 1 / scale;
	root.setAttribute("transform", `translate(${tx},${ty}) scale(${scale})`);

	// Cache 3D projections once per frame
	const projCache = {};
	if (graph3DMode) {
		for (const id in graphNodes) {
			const n = graphNodes[id];
			projCache[id] = project3D(n.x, n.y, n.z || 0);
		}
	}
	const proj = (id) => {
		const n = graphNodes[id];
		if (!n) return null;
		if (graph3DMode) {
			const p = projCache[id];
			return p ? { x: p.px, y: p.py, w: p.w, depth: p.depth } : null;
		}
		return { x: n.x, y: n.y, w: 1, depth: 0 };
	};

	const nameToId = {};
	for (const id in state.territories) nameToId[state.territories[id].name] = id;

	// Degree map
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

	// Rendering helpers
	const appendParentEdge = (pa, pb) => {
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", pa.x); line.setAttribute("y1", pa.y);
		line.setAttribute("x2", pb.x); line.setAttribute("y2", pb.y);
		line.setAttribute("class", "gedge-parent");
		line.setAttribute("stroke-width", 1.8 * isc);
		line.setAttribute("stroke-dasharray", `${3 * isc} ${3 * isc}`);
		root.appendChild(line);
	};

	const appendEdge = (e, pa, pb) => {
		const type = e.type || "both";
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
		line.setAttribute("x1", pa.x); line.setAttribute("y1", pa.y);
		line.setAttribute("x2", pb.x); line.setAttribute("y2", pb.y);
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
	};

	const appendNode = (id, p) => {
		const t = state.territories[id];
		if (!t) return;
		const n = graphNodes[id];
		const R = 13 * isc;
		const typeColor = t.type === "sea" ? "var(--accent-2)" : "var(--rule)";
		const ownerColor = getOwnerColor(t.owner);
		const isOwned = t.owner && t.owner !== "neutral";

		const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
		g.setAttribute("class", "gnode" +
			(n.anchored ? " anchored" : "") +
			(graphDrag && graphDrag.id === id ? " dragging" : ""));
		g.setAttribute("transform", graph3DMode
			? `translate(${p.x},${p.y}) scale(${p.w})`
			: `translate(${p.x},${p.y})`);
		g.dataset.id = id;

		const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		hit.setAttribute("r", 26 * isc); hit.setAttribute("class", "gn-hit");
		g.appendChild(hit);

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
			const td = degMax > degMin ? (degreeMap[id] - degMin) / (degMax - degMin) : 0.5;
			shape.setAttribute("fill", degreeGradientColor(td));
			shape.setAttribute("stroke", "#2228");
			shape.setAttribute("stroke-width", 2.0 * isc);
		} else {
			shape.setAttribute("fill", typeColor);
			shape.setAttribute("stroke", isOwned ? ownerColor : "#444");
			shape.setAttribute("stroke-width", (isOwned ? 4.5 : 2.0) * isc);
		}
		g.appendChild(shape);

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

		if (n.anchored) {
			const ar = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			ar.setAttribute("class", "gn-anchor-ring");
			ar.setAttribute("r", R * 2.2);
			ar.setAttribute("stroke-width", 1.2 * isc);
			ar.setAttribute("stroke-dasharray", `${3.5 * isc} ${2.5 * isc}`);
			g.appendChild(ar);
		}

		const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
		label.setAttribute("class", "gn-label");
		label.setAttribute("y", R + 18 * isc);
		label.setAttribute("font-size", 14 * isc);
		label.textContent = t.name || t.id;
		g.appendChild(label);

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
	};

	if (graph3DMode) {
		// Build a combined draw list of edges and nodes, sort together by depth.
		// Edges use their closest endpoint depth so that an edge whose both ends
		// are closer than a node will always paint on top of that node.
		const items = [];

		for (const id in state.territories) {
			const t = state.territories[id];
			const parent = getParent(t);
			if (!parent) continue;
			const pid = nameToId[parent.name];
			const pa = proj(id), pb = pid && proj(pid);
			if (!pa || !pb) continue;
			items.push({ kind: 'pedge', pa, pb, depth: Math.min(pa.depth, pb.depth) });
		}

		for (const e of state.edges) {
			const pa = proj(e.a), pb = proj(e.b);
			if (!pa || !pb) continue;
			items.push({ kind: 'edge', e, pa, pb, depth: Math.min(pa.depth, pb.depth) });
		}

		for (const id in graphNodes) {
			const p = proj(id);
			if (!p || !state.territories[id]) continue;
			items.push({ kind: 'node', id, p, depth: p.depth });
		}

		items.sort((a, b) => b.depth - a.depth);

		for (const item of items) {
			if (item.kind === 'pedge') appendParentEdge(item.pa, item.pb);
			else if (item.kind === 'edge') appendEdge(item.e, item.pa, item.pb);
			else appendNode(item.id, item.p);
		}
	} else {
		// 2D: edges always behind nodes
		for (const id in state.territories) {
			const t = state.territories[id];
			const parent = getParent(t);
			if (!parent) continue;
			const pid = nameToId[parent.name];
			const pa = proj(id), pb = pid && proj(pid);
			if (!pa || !pb) continue;
			appendParentEdge(pa, pb);
		}
		for (const e of state.edges) {
			const pa = proj(e.a), pb = proj(e.b);
			if (!pa || !pb) continue;
			appendEdge(e, pa, pb);
		}
		for (const id in graphNodes) {
			const p = proj(id);
			if (!p) continue;
			appendNode(id, p);
		}
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

	if (graph3DMode) {
		// In 3D mode: any drag orbits the scene; record clicked node for click detection
		const g = e.target.closest(".gnode");
		graph3DOrbit = {
			startX: e.clientX, startY: e.clientY,
			startRx: graph3DCamera.rx, startRy: graph3DCamera.ry,
			clickedId: g ? g.dataset.id : null,
		};
		if (!graphSim.running) renderGraph();
		return;
	}

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
		graphPan = {
			startX: e.clientX,
			startY: e.clientY,
			startTx: graphViewport.tx,
			startTy: graphViewport.ty,
		};
		document.getElementById("graph-svg").classList.add("panning");
	}
	if (!graphSim.running) renderGraph();
}

function onGraphMouseMove(e) {
	if (graph3DOrbit) {
		const dx = e.clientX - graph3DOrbit.startX;
		const dy = e.clientY - graph3DOrbit.startY;
		graph3DCamera.ry = graph3DOrbit.startRy - dx * 0.005;
		graph3DCamera.rx = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, graph3DOrbit.startRx + dy * 0.005));
		if (!graphSim.running) renderGraph();
	} else if (graphDrag) {
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

function onGraphMouseUp(e) {
	if (graph3DOrbit) {
		// Small movement = click → toggle anchor on the node that was under the cursor
		if (e) {
			const dx = e.clientX - graph3DOrbit.startX;
			const dy = e.clientY - graph3DOrbit.startY;
			if (dx * dx + dy * dy < 25 && graph3DOrbit.clickedId) {
				const n = graphNodes[graph3DOrbit.clickedId];
				if (n) n.anchored = !n.anchored;
			}
		}
		graph3DOrbit = null;
		saveState();
	}
	if (graphDrag) {
		const n = graphNodes[graphDrag.id];
		if (n) {
			const dx = n.x - graphDrag.x0, dy = n.y - graphDrag.y0;
			if (dx * dx + dy * dy < 16 / (graphViewport.scale * graphViewport.scale))
				n.anchored = !n.anchored; // click → toggle anchor
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

// =============================================================================
// GRAPH SIDEBAR
// =============================================================================

function sectionGraphControls() {
	const s = el("div", "sb-section");
	s.appendChild(el("h3", null, "Graph View"));

	const desc = el("div", "hint", graph3DMode
		? "Drag anywhere to orbit · Scroll to zoom · Click node to toggle anchor."
		: "Outer hull nodes are anchored (dashed ring). Click any node to toggle. Drag to move.");
	desc.style.marginBottom = "14px";
	s.appendChild(desc);

	const btnReset = el("button", "toolbtn");
	btnReset.textContent = "Reset Layout";
	btnReset.style.cssText = "width:100%; margin-bottom:6px; display:block;";
	btnReset.onclick = () => {
		syncGraphNodes(true);
		graphRestLen = computeAvgEdgeDist() * graphTensionFactor;
		if (!graph3DMode) pinHullNodes();
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

	// 3D mode toggle
	const modeRow = el("div");
	modeRow.style.cssText = "display:flex; align-items:center; gap:6px; margin-top:10px;";
	const modeChk = el("input");
	modeChk.type = "checkbox";
	modeChk.id = "chk-3d";
	modeChk.checked = graph3DMode;
	modeChk.addEventListener("change", () => {
		graph3DMode = modeChk.checked;
		if (graph3DMode) {
			saveNodesToStore(graphNodes2DSave);
			if (Object.keys(graphNodes3DSave).length > 0) {
				restoreNodesFromStore(graphNodes3DSave);
			} else {
				// First time entering 3D: keep XY layout, seed z
				for (const id in graphNodes) {
					graphNodes[id].z = (Math.random() - 0.5) * 30;
					graphNodes[id].vz = 0;
					graphNodes[id].anchored = false;
				}
			}
		} else {
			saveNodesToStore(graphNodes3DSave);
			restoreNodesFromStore(graphNodes2DSave);
		}
		fitGraphToScreen();
		renderGraph();
		renderSidebar();
		saveState();
	});
	const modeLbl = el("label", null, "3D mode");
	modeLbl.setAttribute("for", "chk-3d");
	modeLbl.style.cursor = "pointer";
	modeRow.appendChild(modeChk);
	modeRow.appendChild(modeLbl);
	s.appendChild(modeRow);

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
	slider.min = "0.1"; slider.max = "1.5"; slider.step = "0.05";
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
	repSlider.min = "0.05"; repSlider.max = "2.0"; repSlider.step = "0.05";
	repSlider.value = graphRepulsionFactor;
	repSlider.style.width = "100%";
	repSlider.addEventListener("input", () => {
		graphRepulsionFactor = parseFloat(repSlider.value);
		repVal.textContent = graphRepulsionFactor.toFixed(2) + "×";
		saveState();
	});
	repWrap.appendChild(repSlider);
	s.appendChild(repWrap);

	const attrWrap = el("div", "field");
	attrWrap.style.marginTop = "10px";
	const attrHeader = el("div");
	attrHeader.style.cssText = "display:flex; justify-content:space-between; margin-bottom:4px;";
	attrHeader.appendChild(el("label", null, "Attraction"));
	const attrVal = el("span", "hint");
	attrVal.textContent = graphAttractionFactor.toFixed(2) + "×";
	attrHeader.appendChild(attrVal);
	attrWrap.appendChild(attrHeader);
	const attrSlider = el("input");
	attrSlider.type = "range";
	attrSlider.min = "0.05"; attrSlider.max = "4.0"; attrSlider.step = "0.05";
	attrSlider.value = graphAttractionFactor;
	attrSlider.style.width = "100%";
	attrSlider.addEventListener("input", () => {
		graphAttractionFactor = parseFloat(attrSlider.value);
		attrVal.textContent = graphAttractionFactor.toFixed(2) + "×";
		saveState();
	});
	attrWrap.appendChild(attrSlider);
	s.appendChild(attrWrap);

	const territories = Object.values(state.territories);
	const nNodes = territories.length;
	const parents = territories.filter(t => !isSubprovince(t));
	const nTerr = parents.length;
	const nLand = parents.filter(t => t.type === "land").length;
	const nCoast = parents.filter(t => t.type === "coast").length;
	const nSea = parents.filter(t => t.type === "sea").length;
	const nSC = parents.filter(t => t.sc).length;
	const nOwnedSC = parents.filter(t => t.sc && t.owner && t.owner !== "neutral").length;
	const nNeutralSC = nSC - nOwnedSC;
	const scPct = (nLand + nCoast) > 0 ? Math.round(nSC / (nLand + nCoast) * 100) : 0;
	const nE = state.edges.length;
	const nodeNote = nNodes !== nTerr ? ` (${nNodes} nodes)` : "";
	const scDetail = nSC > 0 ? `${nOwnedSC} owned · ${nNeutralSC} neutral` : "";
	const stats = el("div", "hint", `${nTerr} territories${nodeNote}: ${nLand} land · ${nCoast} coast · ${nSea} sea\n${nSC} supply centers (${scPct}%): ${scDetail}\n${nE} edges`);
	stats.style.marginTop = "10px";
	stats.style.whiteSpace = "pre";
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
