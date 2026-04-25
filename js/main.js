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
		territories: "Click map to place. Click marker to edit. Drag marker to move.",
		adjacencies: "Click two territories to connect. Drag across an edge to remove it.",
		ownership: "Pick a power at right, then click territories to assign. Click again to clear.",
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
// INIT
// =============================================================================

function init() {
	const restored = loadState();

	document.querySelectorAll(".mode-tabs button").forEach((b) => {
		b.addEventListener("click", () => setMode(b.dataset.mode));
	});

	document.getElementById("btn-load-image").onclick = () => {
		document.getElementById("file-input").click();
	};
	document.getElementById("file-input").onchange = (e) => {
		if (e.target.files[0]) loadImageFromFile(e.target.files[0]);
	};

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
		if (e.dataTransfer.files[0] && e.dataTransfer.files[0].type.startsWith("image/"))
			loadImageFromFile(e.dataTransfer.files[0]);
	});

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
		if (!confirm("This will erase all territories, edges, and powers. Continue?")) return;
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

// =============================================================================
// HELP
// =============================================================================

function toggleHelp() {
	let h = document.querySelector(".help");
	if (h) { h.remove(); return; }
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
      <tr><td><kbd>A</kbd> / <kbd>B</kbd> / <kbd>F</kbd></td><td>Set selected edge type: Army / Both / Fleet</td></tr>
    </table>
  `;
	document.body.appendChild(h);
	h.querySelector(".close").onclick = () => h.remove();
}

init();
