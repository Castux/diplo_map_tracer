// =============================================================================
// STATE
// =============================================================================

const DEFAULT_POWERS = [
	{ id: "neutral", name: "Neutral", color: "#cccccc" },
];

let state = {
	image: null,
	imageW: 0,
	imageH: 0,
	territories: {}, // id -> {id, name, x, y, type: 'land'|'coast'|'sea', sc: bool, owner: powerId}
	edges: [],        // [{a, b, type: 'army'|'fleet'|'both'}]
	powers: [...DEFAULT_POWERS],
	selectedTerritory: null,
	pendingEdge: null,
	selectedEdge: null,
	selectedPower: null,
	mode: "territories",
	viewport: { tx: 0, ty: 0, scale: 1 },
};

let nextTerritoryId = 1;
let jsonFileHandle = null;

const LS_KEY = "diplo-map-tracer-state-v1";
const FSA_SUPPORTED = typeof window.showOpenFilePicker === "function";

function getOwnerColor(ownerId) {
	if (!ownerId || ownerId === "neutral") return "#e8e0cc";
	const p = state.powers.find((pp) => pp.id === ownerId);
	return p ? p.color : "#e8e0cc";
}

// A territory is a subprovince if its name contains '/' after the first character.
function isSubprovince(t) {
	return !!t.name && t.name.indexOf('/') >= 1;
}

// Returns the parent territory object, or null if none exists (or t is not a subprovince).
function getParent(t) {
	if (!isSubprovince(t)) return null;
	const parentName = t.name.slice(0, t.name.indexOf('/'));
	return Object.values(state.territories).find(p => p.name === parentName) || null;
}

// =============================================================================
// PERSISTENCE
// =============================================================================

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

// =============================================================================
// UNDO / REDO
// =============================================================================

const undoStack = [];
const redoStack = [];

function captureState() {
	return JSON.stringify({
		territories: state.territories,
		edges: state.edges,
		powers: state.powers,
		nextTerritoryId,
	});
}

function pushUndo() {
	undoStack.push(captureState());
	if (undoStack.length > 100) undoStack.shift();
	redoStack.length = 0;
}

function undo() {
	if (!undoStack.length) return;
	redoStack.push(captureState());
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
	undoStack.push(captureState());
	const s = JSON.parse(redoStack.pop());
	state.territories = s.territories;
	state.edges = s.edges;
	state.powers = s.powers;
	nextTerritoryId = s.nextTerritoryId;
	state.selectedTerritory = null;
	state.pendingEdge = null;
	saveState();
	renderAll();
}
