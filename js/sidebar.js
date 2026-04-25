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
		sb.appendChild(sectionValidation());
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

function escapeHtml(s) {
	return (s || "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
}

function cssToHex(color) {
	const ctx = document.createElement("canvas").getContext("2d");
	ctx.fillStyle = color;
	return ctx.fillStyle;
}

// =============================================================================
// TERRITORY EDITOR
// =============================================================================

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
		if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); }
	});
	nameF.appendChild(nameInput);
	s.appendChild(nameF);
	if (!t._nameFocused) {
		t._nameFocused = true;
		setTimeout(() => { nameInput.focus(); nameInput.select(); }, 10);
	}

	const typeF = el("div", "field");
	typeF.appendChild(el("label", null, "Type   (L · C · S)"));
	const typeRow = el("div", "radio-row");
	for (const [val, lbl] of [["land", "Land"], ["coast", "Coast"], ["sea", "Sea"]]) {
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
			if (val === "sea") { t.owner = null; t.sc = false; }
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

	const del = el("button", "toolbtn danger", "Delete territory");
	del.style.marginTop = "8px";
	del.addEventListener("click", () => {
		if (!confirm(`Delete ${t.name || "this territory"}?`)) return;
		pushUndo();
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

// =============================================================================
// ADJACENCY SECTIONS
// =============================================================================

function sectionAdjacencyHelp() {
	const s = el("div", "sb-section");
	s.appendChild(el("h3", null, "Adjacencies"));

	const info = el("div");
	info.style.fontSize = "12px";
	info.style.lineHeight = "1.6";
	info.innerHTML = `
    <p style="margin:0 0 6px"><b>Single pair:</b> click A, then B.</p>
    <p style="margin:0 0 6px"><b>Remove edge:</b> click-drag across an edge line, or use the selected-territory list below.</p>
    <p style="margin:0"><b>Edge type:</b> select an edge, then press <kbd>A</kbd> army · <kbd>B</kbd> both · <kbd>F</kbd> fleet.</p>
  `;
	s.appendChild(info);

	const fixable = state.edges.filter(e => {
		const ta = state.territories[e.a]?.type, tb = state.territories[e.b]?.type;
		if (ta === "coast" && tb === "coast") return false;
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
	s.appendChild(el("h3", null, "Neighbors of selected"));
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
					(e) => !((e.a === id && e.b === n.id) || (e.a === n.id && e.b === id)),
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

// =============================================================================
// POWERS
// =============================================================================

function sectionPowers() {
	const s = el("div", "sb-section");
	const h = el("h3");
	h.innerHTML = `Powers <span class='count'>${state.powers.filter((p) => p.id !== "neutral").length}</span>`;
	s.appendChild(h);

	const info = el("div", "hint");
	info.style.fontSize = "11px";
	info.style.marginBottom = "8px";
	info.textContent = "Pick a power, then click territories. Click a territory a second time to clear.";
	s.appendChild(info);

	const list = el("div", "power-list");
	const realPowers = state.powers.filter((p) => p.id !== "neutral");

	realPowers.forEach((p) => {
		const row = el(
			"div",
			"power-row" + (state.selectedPower === p.id ? " selected" : ""),
		);
		const sw = el("span", "power-swatch");
		sw.style.background = p.color;
		row.appendChild(sw);

		const nn = el("input");
		nn.type = "text";
		nn.value = p.name;
		nn.style.flex = "1";
		nn.style.background = "transparent";
		nn.style.border = "none";
		nn.style.font = "inherit";
		nn.style.fontSize = "12px";
		nn.style.color = state.selectedPower === p.id ? "var(--paper)" : "var(--ink)";
		nn.style.padding = "0";
		nn.addEventListener("input", () => { p.name = nn.value; saveState(); renderTerritoryListOnly(); });
		nn.addEventListener("click", (ev) => ev.stopPropagation());
		row.appendChild(nn);

		const homeCount = Object.values(state.territories).filter(
			(t) => t.sc && t.owner === p.id,
		).length;
		row.appendChild(el("span", "pc-count", `${homeCount}`));

		row.addEventListener("click", () => {
			state.selectedPower = state.selectedPower === p.id ? null : p.id;
			renderAll();
		});
		row.addEventListener("contextmenu", (ev) => {
			ev.preventDefault();
			openPowerEditor(p);
		});
		list.appendChild(row);
	});

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

	const h2 = el("div", "hint");
	h2.style.fontSize = "10px";
	h2.style.marginTop = "4px";
	h2.textContent = "Right-click a power to change color / home-SC target / delete.";
	s.appendChild(h2);

	return s;
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
		if (!confirm(`Delete power ${p.name}? Territories owned by it become neutral.`)) return;
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

// =============================================================================
// VALIDATION
// =============================================================================

function sectionValidation() {
	const s = el("div", "sb-section");
	s.appendChild(el("h3", null, "Validation"));

	const issues = validate();
	const box = el("div", "validation");
	if (!issues.length) {
		box.appendChild(vline("v-ok", "✓ No issues."));
	} else {
		for (const issue of issues) {
			box.appendChild(vline("v-" + issue.sev, issue.msg));
		}
	}
	s.appendChild(box);
	return s;

	function vline(cls, text) {
		const d = el("div", "v-line " + cls);
		d.textContent = text;
		return d;
	}
}

function validate() {
	const issues = [];
	for (const t of Object.values(state.territories)) {
		if (!t.name || !t.name.trim()) {
			issues.push({ sev: "warn", msg: `Unnamed territory (${t.id})` });
		}
	}
	const names = {};
	for (const t of Object.values(state.territories)) {
		if (!t.name) continue;
		names[t.name] = (names[t.name] || 0) + 1;
	}
	for (const n in names)
		if (names[n] > 1)
			issues.push({ sev: "err", msg: `Duplicate name "${n}" × ${names[n]}` });

	for (const t of Object.values(state.territories)) {
		if (t.type === "sea" && (t.owner || t.sc))
			issues.push({ sev: "err", msg: `Sea "${t.name}" has owner/SC` });
	}
	for (const e of state.edges) {
		const a = state.territories[e.a], b = state.territories[e.b];
		if (!a || !b) {
			issues.push({ sev: "err", msg: `Dangling edge ${e.a}↔${e.b}` });
			continue;
		}
		const type = e.type || "both";
		const na = a.name || a.id, nb = b.name || b.id;
		if (type === "army" || type === "both") {
			if (a.type === "sea") issues.push({ sev: "warn", msg: `"${na}" is sea but has army edge to "${nb}"` });
			if (b.type === "sea") issues.push({ sev: "warn", msg: `"${nb}" is sea but has army edge to "${na}"` });
		}
		if (type === "fleet" || type === "both") {
			if (a.type === "land") issues.push({ sev: "warn", msg: `"${na}" is land but has fleet edge to "${nb}"` });
			if (b.type === "land") issues.push({ sev: "warn", msg: `"${nb}" is land but has fleet edge to "${na}"` });
		}
		if (!(a.type === "coast" && b.type === "coast")) {
			const inferred = inferEdgeType(e.a, e.b);
			if (inferred !== type)
				issues.push({ sev: "info", msg: `"${na}" ↔ "${nb}": type is ${type}, inferred ${inferred}` });
		}
	}
	return issues;
}
