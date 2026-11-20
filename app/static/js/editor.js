/* Resume editor: renders the form from state, autosaves, refreshes the live preview,
   and wires the AI suggestion panels. Vanilla JS, no build step. */
(() => {
  "use strict";

  const boot = JSON.parse(document.getElementById("resume-json").textContent);
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;
  const state = { title: boot.title, template: boot.template, data: boot.data };
  const editorEl = document.getElementById("editor");
  const saveStateEl = document.getElementById("save-state");
  const preview = document.getElementById("preview");
  const previewPane = document.getElementById("preview-pane");

  const openSections = new Set(["personal", "summary", "experience"]);
  const ai = {};            // key -> {loading, suggestions, notice, error, report}
  let jobDescription = "";

  // ------------------------------------------------------------------ helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function getPath(path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), state.data);
  }
  function setPath(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const parent = keys.reduce((o, k) => o[k], state.data);
    parent[last] = value;
  }

  const SECTIONS = {
    experience: { label: "Experience", fields: [["role", "Job title"], ["company", "Company"], ["location", "Location"], ["start", "Start (e.g. Jan 2025)"], ["end", "End (or Present)"]], bullets: true,
                  blank: () => ({ role: "", company: "", location: "", start: "", end: "", bullets: [""] }) },
    projects: { label: "Projects", fields: [["name", "Project name"], ["tech", "Tech stack"], ["link", "Link (GitHub / demo)"]], bullets: true,
                blank: () => ({ name: "", tech: "", link: "", bullets: [""] }) },
    education: { label: "Education", fields: [["degree", "Degree"], ["school", "College / university"], ["location", "Location"], ["score", "CGPA / %"], ["start", "Start year"], ["end", "End year"]],
                 blank: () => ({ degree: "", school: "", location: "", start: "", end: "", score: "" }) },
    certifications: { label: "Certifications", fields: [["name", "Certification"], ["issuer", "Issuer"], ["date", "Date"]],
                      blank: () => ({ name: "", issuer: "", date: "" }) },
  };

  // ------------------------------------------------------------------ rendering
  function input(path, label, opts = {}) {
    const v = getPath(path) ?? "";
    const tag = opts.textarea
      ? `<textarea data-path="${path}" rows="${opts.rows || 3}" placeholder="${esc(opts.placeholder || "")}">${esc(v)}</textarea>`
      : `<input type="text" data-path="${path}" value="${esc(v)}" placeholder="${esc(opts.placeholder || "")}">`;
    return `<div class="${opts.cls || ""}"><label>${esc(label)}</label>${tag}</div>`;
  }

  function section(key, title, count, body, action = "") {
    return `<details class="section" data-section="${key}" ${openSections.has(key) ? "open" : ""}>
      <summary>${esc(title)} ${count != null ? `<span class="count">(${count})</span>` : ""}${action}</summary>
      <div class="section-body">${body}</div></details>`;
  }

  function aiPanel(key, renderItem) {
    const p = ai[key];
    if (!p) return "";
    let inner;
    if (p.loading) inner = `<div class="small muted"><span class="spinner"></span> Thinking…</div>`;
    else if (p.error) inner = `<div class="small" style="color:var(--err)">${esc(p.error)}</div>`;
    else inner = (p.notice ? `<div class="ai-notice">${esc(p.notice)}</div>` : "") + p.suggestions.map(renderItem).join("");
    return `<div class="ai-panel"><h4>✨ AI suggestions ${p.provider ? `<span class="small muted">(${esc(p.provider)})</span>` : ""}
      <button class="icon-btn close" data-act="ai-close" data-key="${key}" title="Close">✕</button></h4>${inner}</div>`;
  }

  function bulletsEditor(sec, i, item) {
    const rows = item.bullets.map((b, j) => `<div class="bullet-row">
        <textarea data-path="${sec}.${i}.bullets.${j}" placeholder="Start with an action verb; add a number if you can">${esc(b)}</textarea>
        <button class="icon-btn danger" data-act="del-bullet" data-sec="${sec}" data-i="${i}" data-j="${j}" title="Remove bullet">✕</button>
      </div>`).join("");
    const key = `${sec}.${i}`;
    const panel = aiPanel(key, (s, k) => `<div class="ai-suggestion"><p>${esc(s)}</p>
        <button class="btn btn-sm btn-ai" data-act="ai-bullet" data-key="${key}" data-k="${k}">${k < item.bullets.filter((x) => x.trim()).length ? `Replace #${k + 1}` : "Add"}</button></div>`)
      + (ai[key] && !ai[key].loading && !ai[key].error && ai[key].suggestions.length > 1
        ? `<div class="ai-actions"><button class="btn btn-sm btn-ai" data-act="ai-bullets-all" data-key="${key}">Replace all bullets</button></div>` : "");
    return `<label style="margin-top:10px">Bullet points</label>${rows}
      <div class="row" style="gap:6px"><button class="btn btn-sm" data-act="add-bullet" data-sec="${sec}" data-i="${i}">+ Bullet</button>
      <button class="btn btn-sm btn-ai" data-act="ai" data-kind="bullets" data-key="${key}">✨ Improve with AI</button></div>${panel}`;
  }

  function listSection(sec) {
    const cfg = SECTIONS[sec];
    const items = state.data[sec];
    const body = items.map((item, i) => `<div class="item">
        <div class="item-head">#${i + 1} <span class="spacer"></span>
          <button class="icon-btn" data-act="move" data-sec="${sec}" data-i="${i}" data-dir="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-btn" data-act="move" data-sec="${sec}" data-i="${i}" data-dir="1" title="Move down" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
          <button class="icon-btn danger" data-act="del-item" data-sec="${sec}" data-i="${i}" title="Remove">🗑</button></div>
        <div class="grid-2">${cfg.fields.map(([f, label]) => input(`${sec}.${i}.${f}`, label)).join("")}</div>
        ${cfg.bullets ? bulletsEditor(sec, i, item) : ""}
      </div>`).join("");
    return section(sec, cfg.label, items.length, body + `<button class="btn btn-sm" data-act="add-item" data-sec="${sec}">+ Add ${cfg.label.toLowerCase().replace(/s$/, "")}</button>`);
  }

  function render() {
    const d = state.data;
    const html = [];

    html.push(section("personal", "Personal details", null, `<div class="grid-2">
      ${input("personal.full_name", "Full name")}${input("personal.headline", "Headline", { placeholder: "Backend Engineer | Python, SQL" })}
      ${input("personal.email", "Email")}${input("personal.phone", "Phone")}
      ${input("personal.location", "Location")}${input("target_role", "Target role (used by AI)", { placeholder: "e.g. Data Engineer" })}
      ${input("personal.linkedin", "LinkedIn")}${input("personal.github", "GitHub")}
      ${input("personal.website", "Website")}</div>`));

    html.push(section("summary", "Professional summary", null,
      input("summary", "Summary", { textarea: true, rows: 4, placeholder: "2–3 sentences: who you are, your strongest evidence, what you want next." })
      + `<div class="row" style="margin-top:8px"><button class="btn btn-sm btn-ai" data-act="ai" data-kind="summary" data-key="summary">✨ Generate with AI</button></div>`
      + aiPanel("summary", (s, k) => `<div class="ai-suggestion"><p>${esc(s)}</p><button class="btn btn-sm btn-ai" data-act="ai-summary" data-k="${k}">Use</button></div>`)));

    html.push(listSection("experience"));
    html.push(listSection("projects"));
    html.push(listSection("education"));

    const skillsBody = d.skills.map((g, i) => `<div class="item"><div class="item-head">Group ${i + 1}<span class="spacer"></span>
        <button class="icon-btn danger" data-act="del-item" data-sec="skills" data-i="${i}" title="Remove">🗑</button></div>
        <div class="grid-2" style="grid-template-columns:1fr 2fr">
          ${input(`skills.${i}.category`, "Category", { placeholder: "Languages" })}
          <div><label>Skills (comma separated)</label><input type="text" data-skills="${i}" value="${esc(g.items.join(", "))}" placeholder="Python, SQL, Docker"></div>
        </div></div>`).join("")
      + `<div class="row" style="gap:6px"><button class="btn btn-sm" data-act="add-item" data-sec="skills">+ Skill group</button>
         <button class="btn btn-sm btn-ai" data-act="ai" data-kind="skills" data-key="skills">✨ Suggest skills</button></div>`
      + aiPanel("skills", (s, k) => {
        const have = d.skills.some((g) => g.items.some((x) => x.toLowerCase() === s.toLowerCase()));
        return `<button class="chip ${have ? "added" : ""}" data-act="ai-skill" data-k="${k}" ${have ? "disabled" : ""}>${have ? "✓" : "+"} ${esc(s)}</button>`;
      });
    html.push(section("skills", "Skills", d.skills.length, skillsBody));

    html.push(listSection("certifications"));

    const achBody = d.achievements.map((a, j) => `<div class="bullet-row">
        <textarea data-path="achievements.${j}" placeholder="e.g. Finalist, Smart India Hackathon 2026">${esc(a)}</textarea>
        <button class="icon-btn danger" data-act="del-ach" data-j="${j}" title="Remove">✕</button></div>`).join("")
      + `<button class="btn btn-sm" data-act="add-ach">+ Achievement</button>`;
    html.push(section("achievements", "Achievements", d.achievements.length, achBody));

    // Job-description tailoring
    const jd = ai.jd;
    let jdOut = "";
    if (jd?.report) {
      const r = jd.report;
      jdOut = `<div class="ai-panel"><h4>🎯 Match report <span class="small muted">(${esc(jd.provider)})</span>
          <button class="icon-btn close" data-act="ai-close" data-key="jd">✕</button></h4>
        ${jd.notice ? `<div class="ai-notice">${esc(jd.notice)}</div>` : ""}
        <div class="score"><div class="score-ring" style="--p:${r.score}">${r.score}%</div>
          <div class="small">Keyword match with the job description.<br><span class="muted">Aim for 70%+, but only add skills you really have.</span></div></div>
        ${r.missing.length ? `<div class="small" style="margin-bottom:4px"><b>Missing</b></div>${r.missing.map((k) => `<span class="kw miss">${esc(k)}</span>`).join("")}` : ""}
        ${r.matched.length ? `<div class="small" style="margin:6px 0 4px"><b>Found</b></div>${r.matched.map((k) => `<span class="kw hit">${esc(k)}</span>`).join("")}` : ""}
        <div class="small" style="margin:10px 0 6px"><b>Suggestions</b></div>
        ${jd.suggestions.map((s) => `<div class="ai-suggestion"><p>${esc(s)}</p></div>`).join("")}</div>`;
    } else if (jd) {
      jdOut = aiPanel("jd", (s) => `<div class="ai-suggestion"><p>${esc(s)}</p></div>`);
    }
    html.push(section("tailor", "🎯 Tailor to a job description", null,
      `<label>Paste the job description</label><textarea id="jd" rows="6" placeholder="Paste the full job posting here…">${esc(jobDescription)}</textarea>
       <div class="row" style="margin-top:8px"><button class="btn btn-sm btn-ai" data-act="ai" data-kind="keywords" data-key="jd">Analyze match</button></div>${jdOut}`));

    editorEl.innerHTML = html.join("");
  }

  // ------------------------------------------------------------------ saving + preview
  let saveTimer = null, saving = false, dirty = false, pendingAgain = false;

  function setSaveState(text, cls = "") {
    saveStateEl.textContent = text;
    saveStateEl.className = "save-state " + cls;
  }

  function scheduleSave(delay = 700) {
    dirty = true;
    setSaveState("Unsaved…", "saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, delay);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (saving) { pendingAgain = true; return; }
    saving = true;
    dirty = false;
    setSaveState("Saving…", "saving");
    try {
      const res = await fetch(boot.apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify({ title: state.title, template: state.template, data: state.data }),
      });
      if (res.status === 401) { window.location = "/login?next=" + encodeURIComponent(location.pathname); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      setSaveState("Saved");
      refreshPreview();
    } catch (err) {
      dirty = true;
      setSaveState("Save failed — retrying", "error");
      saveTimer = setTimeout(save, 4000);
    } finally {
      saving = false;
      if (pendingAgain) { pendingAgain = false; save(); }
    }
  }

  function refreshPreview() {
    const scroll = previewPane.scrollTop;
    preview.addEventListener("load", () => { previewPane.scrollTop = scroll; }, { once: true });
    preview.contentWindow.location.replace(`${boot.previewUrl}?template=${encodeURIComponent(state.template)}&t=${Date.now()}`);
  }

  function fitPreview() {
    try {
      const doc = preview.contentDocument;
      if (doc?.body) preview.style.height = Math.max(1123, doc.documentElement.scrollHeight) + "px";
    } catch (_) { /* cross-origin guard */ }
    const scale = Math.min(1, (previewPane.clientWidth - 48) / 794);
    preview.style.transform = `scale(${scale})`;
    preview.style.marginBottom = `${(scale - 1) * preview.offsetHeight}px`;
  }
  preview.addEventListener("load", fitPreview);
  window.addEventListener("resize", fitPreview);

  window.addEventListener("beforeunload", (e) => {
    if (dirty || saving) { e.preventDefault(); e.returnValue = ""; }
  });

  const pdfBtn = document.getElementById("pdf-btn");
  pdfBtn.addEventListener("click", async (e) => {
    if (dirty || saving) {        // make sure the PDF reflects the latest edits
      e.preventDefault();
      while (saving) await new Promise((r) => setTimeout(r, 100));
      if (dirty) await save();
      while (saving) await new Promise((r) => setTimeout(r, 100));
      window.location = pdfBtn.href;
    }
  });

  document.getElementById("title").addEventListener("input", (e) => { state.title = e.target.value; scheduleSave(); });
  document.getElementById("template").addEventListener("change", (e) => { state.template = e.target.value; save(); });

  // ------------------------------------------------------------------ AI
  async function requestAI(kind, key) {
    const context = { resume: state.data, target_role: state.data.target_role };
    if (kind === "bullets") {
      const [sec, i] = key.split(".");
      context.item = state.data[sec][Number(i)];
    }
    if (kind === "keywords") context.job_description = jobDescription;
    ai[key] = { loading: true, suggestions: [] };
    render();
    try {
      const res = await fetch(boot.aiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify({ kind, context }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      ai[key] = { loading: false, suggestions: body.suggestions || [], provider: body.provider, notice: body.notice, report: body.report };
    } catch (err) {
      ai[key] = { loading: false, suggestions: [], error: err.message };
    }
    render();
  }

  // ------------------------------------------------------------------ events
  editorEl.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.path) { setPath(t.dataset.path, t.value); scheduleSave(); }
    else if (t.dataset.skills != null) {
      state.data.skills[Number(t.dataset.skills)].items = t.value.split(",").map((s) => s.trim()).filter(Boolean);
      scheduleSave();
    } else if (t.id === "jd") jobDescription = t.value;
  });

  editorEl.addEventListener("toggle", (e) => {
    const key = e.target.dataset?.section;
    if (!key) return;
    e.target.open ? openSections.add(key) : openSections.delete(key);
  }, true);

  editorEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    e.preventDefault();
    const { act, sec, key } = b.dataset;
    const i = Number(b.dataset.i), j = Number(b.dataset.j), k = Number(b.dataset.k);
    const d = state.data;
    let structural = true;

    switch (act) {
      case "add-item":
        d[sec].push(sec === "skills" ? { category: "", items: [] } : SECTIONS[sec].blank());
        openSections.add(sec);
        break;
      case "del-item":
        if (!confirm("Remove this entry?")) return;
        d[sec].splice(i, 1);
        Object.keys(ai).filter((x) => x.startsWith(sec + ".")).forEach((x) => delete ai[x]);
        break;
      case "move": {
        const to = i + Number(b.dataset.dir);
        if (to < 0 || to >= d[sec].length) return;
        [d[sec][i], d[sec][to]] = [d[sec][to], d[sec][i]];
        break;
      }
      case "add-bullet": d[sec][i].bullets.push(""); break;
      case "del-bullet": d[sec][i].bullets.splice(j, 1); break;
      case "add-ach": d.achievements.push(""); break;
      case "del-ach": d.achievements.splice(j, 1); break;

      case "ai":
        if (b.dataset.kind === "keywords" && jobDescription.trim().length < 30) {
          ai.jd = { loading: false, suggestions: [], error: "Paste a job description (at least a few lines) first." };
          render();
          return;
        }
        requestAI(b.dataset.kind, key);
        return;
      case "ai-close": delete ai[key]; structural = false; render(); return;
      case "ai-summary": d.summary = ai.summary.suggestions[k]; break;
      case "ai-bullet": {
        const [s, idx] = key.split(".");
        const item = d[s][Number(idx)];
        const text = ai[key].suggestions[k];
        const filledIdx = item.bullets.map((x, n) => (x.trim() ? n : -1)).filter((n) => n >= 0);
        if (k < filledIdx.length) item.bullets[filledIdx[k]] = text;   // replace the k-th written bullet
        else {
          const empty = item.bullets.findIndex((x) => !x.trim());
          empty >= 0 ? (item.bullets[empty] = text) : item.bullets.push(text);
        }
        break;
      }
      case "ai-bullets-all": {
        const [s, idx] = key.split(".");
        d[s][Number(idx)].bullets = [...ai[key].suggestions];
        delete ai[key];
        break;
      }
      case "ai-skill": {
        const skill = ai.skills.suggestions[k];
        if (!d.skills.length) d.skills.push({ category: "Skills", items: [] });
        d.skills[d.skills.length - 1].items.push(skill);
        break;
      }
      default: return;
    }
    render();
    if (structural) scheduleSave(300);
  });

  render();
})();
