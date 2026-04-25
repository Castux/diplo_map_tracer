// =============================================================================
// CANVAS INTERACTION
// =============================================================================

let _mouseImg = null;
let _panStart = null;
let _panActive = false;
let _dragMarker = null; // {id, x0, y0} — null when not dragging
let _spaceHeld = false;
let _edgeSweepActive = false;
let _edgeSweepStart = null;
let _edgeSweepOrigin = null;
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
		const t = state.territories[_dragMarker.id];
		t.x = img.x;
		t.y = img.y;
		renderOverlay();
		return;
	}
	if (_edgeSweepActive && _edgeSweepStart) {
		const cur = img;
		const removed = [];
		for (const edge of state.edges) {
			const a = state.territories[edge.a], b = state.territories[edge.b];
			if (!a || !b) continue;
			if (segmentsIntersect(
				_edgeSweepStart.x, _edgeSweepStart.y,
				cur.x, cur.y,
				a.x, a.y,
				b.x, b.y,
			)) {
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
		const t = state.territories[_dragMarker.id];
		if (t && (t.x !== _dragMarker.x0 || t.y !== _dragMarker.y0)) {
			pushUndo();
			saveState();
		}
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
	const vx = cx - r.left, vy = cy - r.top;
	const radiusScreen = 12;
	let best = null, bestD = radiusScreen * radiusScreen;
	for (const id in state.territories) {
		const t = state.territories[id];
		const sx = t.x * state.viewport.scale + state.viewport.tx;
		const sy = t.y * state.viewport.scale + state.viewport.ty;
		const d = (sx - vx) ** 2 + (sy - vy) ** 2;
		if (d < bestD) { bestD = d; best = id; }
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
	) return true;
	return false;
}

function handleMarkerClick(id, e) {
	if (state.mode === "territories") {
		state.selectedTerritory = id;
		const t = state.territories[id];
		_dragMarker = { id, x0: t.x, y0: t.y };
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
	const type = inferEdgeType(a, b);
	state.edges.push({ a, b, type });
	state.selectedEdge = { a, b };
	saveState();
}

function panTo(imgX, imgY) {
	const wrapEl = wrap();
	state.viewport.tx = wrapEl.clientWidth / 2 - imgX * state.viewport.scale;
	state.viewport.ty = wrapEl.clientHeight / 2 - imgY * state.viewport.scale;
	applyTransform();
}

// =============================================================================
// KEYBOARD
// =============================================================================

function onKeyDown(e) {
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
	} else if (state.mode === "adjacencies" && state.selectedEdge) {
		const edge = state.edges.find(ed => ed.a === state.selectedEdge.a && ed.b === state.selectedEdge.b);
		if (edge) {
			if (e.key === "a" || e.key === "A") {
				pushUndo(); edge.type = "army"; saveState(); renderAll();
			} else if (e.key === "b" || e.key === "B") {
				pushUndo(); edge.type = "both"; saveState(); renderAll();
			} else if (e.key === "f" || e.key === "F") {
				pushUndo(); edge.type = "fleet"; saveState(); renderAll();
			}
		}
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
			pushUndo(); t.type = "land"; saveState(); renderAll();
		} else if (e.key === "c" || e.key === "C") {
			pushUndo(); t.type = "coast"; saveState(); renderAll();
		} else if (e.key === "s") {
			pushUndo(); t.type = "sea"; t.owner = null; saveState(); renderAll();
		} else if (e.key === "S") {
			pushUndo(); t.sc = !t.sc; saveState(); renderAll();
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
// WHEEL ZOOM
// =============================================================================

function onWheel(e) {
	if (!state.imageW) return;
	e.preventDefault();
	const delta = -e.deltaY;
	const factor = Math.exp(delta * 0.0015);
	const newScale = Math.max(0.05, Math.min(8, state.viewport.scale * factor));
	const r = wrap().getBoundingClientRect();
	const cx = e.clientX - r.left, cy = e.clientY - r.top;
	const ratio = newScale / state.viewport.scale;
	state.viewport.tx = cx - (cx - state.viewport.tx) * ratio;
	state.viewport.ty = cy - (cy - state.viewport.ty) * ratio;
	state.viewport.scale = newScale;
	applyTransform();
	saveState();
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
		powers[p.name] = { color: p.color, home_supply_centers: homes };
	}

	const territories = {};
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

	if (jsonFileHandle) {
		try {
			const writable = await jsonFileHandle.createWritable();
			await writable.write(blob);
			await writable.close();
			flashSaved(`✓ saved to ${jsonFileHandle.name}`, 2000);
			return;
		} catch {
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
	if (!confirm("Importing will replace the current extraction. Proceed?"))
		return false;
	pushUndo();

	if (obj.territories && !Array.isArray(obj.territories) && obj.powers) {
		state.territories = {};
		state.edges = [];
		state.powers = [{ id: "neutral", name: "Neutral", color: "#cccccc" }];

		const nameToId = {};
		let next = 1;

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

		const seen = new Set();
		for (const tname in obj.territories) {
			const td = obj.territories[tname];
			const a = nameToId[tname];
			const adjRaw = td.adjacent || {};
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
		alert("Unrecognized JSON shape. Expected {territories:{name:{...}}, powers:{...}}.");
		return;
	}

	saveState();
	renderAll();
}
