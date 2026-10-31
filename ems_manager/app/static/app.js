// Per-inverter entity lists and EMS modes, from profiles.py via api/profiles.
let profiles = {};
// Every entity mapping saved so far, including ones for fields the current
// inverter doesn't show, so switching inverter type and back loses nothing.
let savedEntities = {};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

// Saved schedules in list order, exactly as last loaded from or saved to the
// server. Edits happen on a copy in the editor and only land here on Save.
let windows = [];
// Ids the scheduler reported active on its last poll.
let activeIds = new Set();
// Day the timeline shows; follows today until the user picks another.
let timelineDay = todayKey();
let reorderMode = false;
// The schedule open in the editor: { id (null for a new one), hash, node,
// baseline (its values when opened, to spot unsaved changes) }.
let editing = null;
// True when the editor was opened from the list, so Back can pop that
// history entry instead of adding another one.
let openedFromList = false;

function todayKey() {
  // getDay() starts the week on Sunday; DAY_KEYS (like the scheduler) on Monday.
  return DAY_KEYS[(new Date().getDay() + 6) % 7];
}

function currentProfile() {
  return profiles[document.getElementById("inverter-type").value] || Object.values(profiles)[0];
}

function fillModeOptions(select, value) {
  const profile = currentProfile();
  select.innerHTML = "";
  const options = [["", "-- don't manage --"], ...profile.modes];
  // Keep a mode that isn't valid for this inverter visible rather than
  // silently dropping it, so the user can see what needs changing.
  if (value && !profile.modes.some(([v]) => v === value)) {
    options.push([value, `${value} (not a ${profile.label} mode)`]);
  }
  options.forEach(([v, label]) => select.add(new Option(label, v)));
  select.value = value || "";
}

function modeLabel(value) {
  const match = currentProfile().modes.find(([v]) => v === value);
  return match ? match[1] : value;
}

// Colour group for a mode on the timeline and the list's stripe.
function modeKind(mode) {
  if (!mode) return "none";
  const profile = currentProfile();
  if (profile.discharge_modes.includes(mode)) return "dis";
  if (profile.charge_modes.includes(mode)) return "chg";
  return "other";
}

function updateModeVisibility(node) {
  const profile = currentProfile();
  const mode = node.querySelector(".w-ems-mode").value;
  const isDischarge = profile.discharge_modes.includes(mode);
  const isCharge = profile.charge_modes.includes(mode);
  const showFor = (el, show) => {
    // labels need flex (matches the rest of the form's layout); the plain
    // hint paragraph needs block - "" won't work here since it would just
    // fall back to the stylesheet's own display:none default.
    el.style.display = show ? (el.tagName === "LABEL" ? "flex" : "block") : "none";
  };
  node.querySelectorAll(".mode-discharge-only").forEach((el) => showFor(el, isDischarge));
  node.querySelectorAll(".mode-charge-only").forEach((el) => showFor(el, isCharge));
  // "Other" covers every mode except discharging - charging, self
  // consumption, standby, PCS remote, V2G, and no mode selected at all.
  node.querySelectorAll(".mode-other-only").forEach((el) => showFor(el, !isDischarge));
  node.querySelectorAll(".import-limit-field").forEach((el) => showFor(el, profile.has_import_limit));
  // With a shared power setpoint only the field for the current direction
  // does anything; separate limits apply in every mode, so always show.
  const byMode = profile.power_control === "shared";
  node.querySelectorAll(".charge-power-field").forEach((el) => showFor(el, !byMode || isCharge));
  node.querySelectorAll(".discharge-power-field").forEach((el) => showFor(el, !byMode || isDischarge));
  node.querySelector(".charge-ramp-text").textContent =
    profile.charge_ramp_field === "import_limit_kw" ? "Ramp import limit" : "Ramp charge power";
}

function updateNotifyVisibility(node) {
  const show = node.querySelector(".w-notify-enabled").checked;
  node.querySelectorAll(".notify-fields").forEach((el) => (el.hidden = !show));
}

let entityDatalistBuilt = false;

async function fetchJSON(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    let detail = `${url} -> ${resp.status}`;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch (e) {}
    throw new Error(detail);
  }
  return resp.json();
}

function sendJSON(url, method, body) {
  return fetchJSON(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ensureEntityDatalist() {
  if (entityDatalistBuilt) return;
  entityDatalistBuilt = true;
  try {
    const matches = await fetchJSON("api/ha/entities?q=");
    const dl = document.createElement("datalist");
    dl.id = "entity-options";
    matches.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.entity_id;
      dl.appendChild(opt);
    });
    document.body.appendChild(dl);
    document.querySelectorAll(".entity-grid input").forEach((inp) => {
      inp.setAttribute("list", "entity-options");
    });
  } catch (e) {
    console.warn("Could not load entity list for autocomplete", e);
  }
}

function renderEntityGrid() {
  const profile = currentProfile();
  document.getElementById("inverter-label").textContent = profile.label;
  const grid = document.getElementById("entity-grid");
  grid.innerHTML = "";
  profile.entities.forEach(([key, label, placeholder]) => {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.key = key;
    input.value = savedEntities[key] || "";
    input.placeholder = placeholder || "domain.entity_id";
    input.setAttribute("list", "entity-options");
    wrapper.appendChild(input);
    grid.appendChild(wrapper);
  });
  ensureEntityDatalist();
}

function collectEntities() {
  document.querySelectorAll("#entity-grid input").forEach((inp) => {
    savedEntities[inp.dataset.key] = inp.value.trim();
  });
  return { ...savedEntities };
}

// ---------- schedule list ----------

function windowDays(win) {
  return win.days || DAY_KEYS;
}

function daysLabel(days) {
  const picked = DAY_KEYS.filter((d) => days.includes(d));
  if (picked.length === 7) return "Every day";
  if (picked.length === 0) return "No days";
  const key = picked.join();
  if (key === "mon,tue,wed,thu,fri") return "Weekdays";
  if (key === "sat,sun") return "Weekends";
  return picked.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
}

function renderRow(win, index) {
  const node = document.getElementById("row-template").content.firstElementChild.cloneNode(true);
  node.dataset.id = win.id;
  node.classList.add(`mode-${modeKind(win.ems_mode)}`);
  node.classList.toggle("is-active", activeIds.has(win.id));
  node.classList.toggle("is-disabled", win.enabled === false);
  node.querySelector(".sched-name").textContent = win.name || "Untitled";
  node.querySelector(".sched-time").textContent = `${win.start}–${win.end}`;
  node.querySelector(".sched-days").textContent = daysLabel(windowDays(win));
  node.querySelector(".sched-mode").textContent = win.ems_mode ? modeLabel(win.ems_mode) : "no mode set";

  const checkbox = node.querySelector(".w-enabled");
  checkbox.checked = win.enabled !== false;
  checkbox.addEventListener("change", () => onEnabledToggle(win, node));
  node.querySelector(".sched-open").addEventListener("click", () => openSchedule(win.id));

  const up = node.querySelector(".move-up");
  const down = node.querySelector(".move-down");
  up.disabled = index === 0;
  down.disabled = index === windows.length - 1;
  up.addEventListener("click", () => moveWindow(index, -1));
  down.addEventListener("click", () => moveWindow(index, 1));
  return node;
}

function renderSchedules() {
  const list = document.getElementById("windows-list");
  list.innerHTML = "";
  windows.forEach((w, i) => list.appendChild(renderRow(w, i)));
  if (windows.length < 2) reorderMode = false;
  list.classList.toggle("reordering", reorderMode);
  const toggle = document.getElementById("reorder-toggle");
  toggle.hidden = windows.length < 2;
  toggle.textContent = reorderMode ? "Done" : "Reorder";
  document.getElementById("windows-empty").hidden = windows.length > 0;
  renderTimeline();
}

async function onEnabledToggle(win, node) {
  const checkbox = node.querySelector(".w-enabled");
  const enabled = checkbox.checked;
  checkbox.disabled = true;
  try {
    await sendJSON(`api/windows/${encodeURIComponent(win.id)}/enabled`, "POST", { enabled });
    win.enabled = enabled;
    flashMsg("windows-save-msg", `${win.name || "Schedule"} turned ${enabled ? "on" : "off"}`);
  } catch (e) {
    checkbox.checked = !enabled;
    flashMsg("windows-save-msg", `Couldn't save: ${e.message}`, true);
  } finally {
    checkbox.disabled = false;
  }
  node.classList.toggle("is-disabled", !checkbox.checked);
  renderTimeline();
}

async function moveWindow(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= windows.length) return;
  const previous = windows.slice();
  [windows[index], windows[target]] = [windows[target], windows[index]];
  renderSchedules();
  try {
    await sendJSON("api/windows/order", "POST", { ids: windows.map((w) => w.id) });
  } catch (e) {
    windows = previous;
    renderSchedules();
    flashMsg("windows-save-msg", `Couldn't save the new order: ${e.message}`, true);
  }
}

// ---------- 24-hour timeline ----------

function minutesOf(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function formatMinutes(total) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// The parts of a day a schedule covers, matching scheduler._window_is_active:
// an overnight schedule (start after end) covers both ends of each day it's
// set for, and one whose start equals its end never runs.
function windowSpans(win) {
  const start = minutesOf(win.start);
  const end = minutesOf(win.end);
  if (start < end) return [[start, end]];
  if (start === end) return [];
  return [[start, 1440], [0, end]].filter(([a, b]) => b > a);
}

// Splits the day wherever any schedule starts or ends, and works out which
// schedules are running in each piece and whose EMS mode wins there.
function timelineSegments(day) {
  const running = windows
    .filter((w) => w.enabled !== false && windowDays(w).includes(day))
    .map((win) => ({ win, spans: windowSpans(win) }));
  const cuts = new Set([0, 1440]);
  running.forEach(({ spans }) => spans.forEach(([a, b]) => cuts.add(a).add(b)));
  const points = [...cuts].sort((a, b) => a - b);

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const active = running
      .filter(({ spans }) => spans.some(([a, b]) => a <= from && from < b))
      .map(({ win }) => win);
    if (!active.length) continue;
    // Lower in the list wins, so the last running schedule that sets a mode decides it.
    const winner = [...active].reverse().find((w) => w.ems_mode) || active[active.length - 1];
    const prev = segments[segments.length - 1];
    const same = prev && prev.to === from && prev.winner === winner &&
      prev.active.length === active.length && prev.active.every((w, j) => w === active[j]);
    if (same) prev.to = to;
    else segments.push({ from, to, winner, active });
  }
  return segments;
}

function renderTimeline() {
  const bar = document.getElementById("timeline-bar");
  bar.innerHTML = "";
  timelineSegments(timelineDay).forEach((seg) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `tl-seg mode-${modeKind(seg.winner.ems_mode)}`;
    el.classList.toggle("overlap", seg.active.length > 1);
    el.style.left = `${(seg.from / 1440) * 100}%`;
    el.style.width = `${((seg.to - seg.from) / 1440) * 100}%`;
    const mode = seg.winner.ems_mode ? modeLabel(seg.winner.ems_mode) : "no mode set";
    const names = seg.active.map((w) => w.name || "Untitled").join(" + ");
    el.title = `${formatMinutes(seg.from)}–${formatMinutes(seg.to)}  ${names} (${mode})`;
    const label = document.createElement("span");
    label.textContent = seg.winner.name || "Untitled";
    el.appendChild(label);
    el.addEventListener("click", () => openSchedule(seg.winner.id));
    bar.appendChild(el);
  });

  const today = todayKey();
  const isToday = timelineDay === today;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const marker = document.getElementById("timeline-marker");
  marker.hidden = !isToday;
  marker.style.left = `${(nowMinutes / 1440) * 100}%`;
  document.getElementById("timeline-day").textContent =
    isToday ? `Today · ${DAY_NAMES[timelineDay]}` : DAY_NAMES[timelineDay];
  document.getElementById("timeline-now").textContent = isToday ? `now ${formatMinutes(nowMinutes)}` : "";
  document.getElementById("timeline-empty").hidden = bar.children.length > 0;
  document.querySelectorAll("#day-picker button").forEach((b) => {
    b.classList.toggle("on", b.dataset.day === timelineDay);
    b.classList.toggle("today", b.dataset.day === today);
  });
}

// ---------- schedule editor ----------

function fillEditor(node, win) {
  node.querySelector(".w-name").value = win.name || "";
  node.querySelector(".w-enabled").checked = win.enabled !== false;
  node.querySelector(".w-start").value = win.start || "";
  node.querySelector(".w-end").value = win.end || "";
  fillModeOptions(node.querySelector(".w-ems-mode"), win.ems_mode);
  node.querySelector(".w-charge").value = win.charge_power_kw ?? "";
  node.querySelector(".w-discharge").value = win.discharge_power_kw ?? "";
  node.querySelector(".w-soc-stop").value = win.soc_stop_percent ?? "";
  node.querySelector(".w-import").value = win.import_limit_kw ?? "";
  node.querySelector(".w-export-min").value = win.min_export_limit_kw ?? "";
  node.querySelector(".w-export-max").value = win.max_export_limit_kw ?? "";
  node.querySelector(".w-export-flat").value = win.flat_export_limit_kw ?? "";
  node.querySelector(".w-discharge-ramp").checked = !!win.discharge_ramp_enabled;
  node.querySelector(".w-charge-ramp").checked = !!win.charge_ramp_enabled;
  node.querySelector(".w-charge-target-soc").value = win.charge_target_percent ?? "";
  node.querySelector(".w-notify-enabled").checked = !!win.notify_enabled;
  node.querySelector(".w-notify-service").value = win.notify_service || "";
  node.querySelector(".w-notify-title").value = win.notify_title || "";
  node.querySelector(".w-notify-message").value = win.notify_message || "";

  const days = windowDays(win);
  node.querySelectorAll("[data-days] input").forEach((cb) => {
    cb.checked = days.includes(cb.value);
  });

  updateModeVisibility(node);
  updateNotifyVisibility(node);
  node.querySelector(".w-ems-mode").addEventListener("change", () => updateModeVisibility(node));
  node.querySelector(".w-notify-enabled").addEventListener("change", () => updateNotifyVisibility(node));
}

function collectWindow(node) {
  const num = (sel) => {
    const v = node.querySelector(sel).value;
    return v === "" ? null : Number(v);
  };
  return {
    name: node.querySelector(".w-name").value.trim() || "Untitled",
    enabled: node.querySelector(".w-enabled").checked,
    days: [...node.querySelectorAll("[data-days] input:checked")].map((cb) => cb.value),
    start: node.querySelector(".w-start").value || "00:00",
    end: node.querySelector(".w-end").value || "00:00",
    ems_mode: node.querySelector(".w-ems-mode").value.trim() || null,
    charge_power_kw: num(".w-charge"),
    discharge_power_kw: num(".w-discharge"),
    soc_stop_percent: num(".w-soc-stop"),
    import_limit_kw: num(".w-import"),
    min_export_limit_kw: num(".w-export-min"),
    max_export_limit_kw: num(".w-export-max"),
    flat_export_limit_kw: num(".w-export-flat"),
    discharge_ramp_enabled: node.querySelector(".w-discharge-ramp").checked,
    charge_ramp_enabled: node.querySelector(".w-charge-ramp").checked,
    charge_target_percent: num(".w-charge-target-soc"),
    notify_enabled: node.querySelector(".w-notify-enabled").checked,
    notify_service: node.querySelector(".w-notify-service").value.trim() || null,
    notify_title: node.querySelector(".w-notify-title").value.trim() || null,
    notify_message: node.querySelector(".w-notify-message").value.trim() || null,
  };
}

function windowIdFromName(name, existingIds) {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "window";
  let id = base;
  let n = 1;
  while (existingIds.has(id)) {
    id = `${base}-${n++}`;
  }
  existingIds.add(id);
  return id;
}

function isDirty() {
  return !!editing && JSON.stringify(collectWindow(editing.node)) !== editing.baseline;
}

function updateEditorTitle() {
  const name = editing.node.querySelector(".w-name").value.trim();
  document.getElementById("editor-title").textContent = name || (editing.id ? "Untitled" : "New schedule");
}

// Each open schedule gets its own address (#schedule-<id>), so the browser
// and the Home Assistant app's back gesture return to the list.
function openSchedule(id) {
  openedFromList = true;
  location.hash = id ? `schedule-${id}` : "new-schedule";
}

function leaveEditor() {
  if (openedFromList) {
    history.back();
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    route();
  }
}

function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  // undefined = the list, null = a new schedule, otherwise a saved schedule's id
  let target;
  if (hash === "new-schedule") target = null;
  else if (hash.startsWith("schedule-")) target = hash.slice("schedule-".length);

  if (editing && editing.hash === hash) return;
  if (isDirty() && !confirm(`Discard your unsaved changes to "${document.getElementById("editor-title").textContent}"?`)) {
    // Put the editor's address back without firing another hashchange.
    history.pushState(null, "", `#${editing.hash}`);
    return;
  }

  const win = target ? windows.find((w) => w.id === target) : null;
  if (target === undefined || (target && !win)) {
    if (target) history.replaceState(null, "", location.pathname + location.search);
    closeEditor();
  } else {
    showEditor(win, hash);
  }
}

function showEditor(win, hash) {
  const node = document.getElementById("window-template").content.firstElementChild.cloneNode(true);
  fillEditor(node, win || { name: "", start: "00:00", end: "00:00", enabled: true });
  editing = { id: win ? win.id : null, hash, node, baseline: JSON.stringify(collectWindow(node)) };
  node.querySelector(".w-name").addEventListener("input", updateEditorTitle);
  node.querySelector(".remove-window").textContent = win ? "Delete schedule" : "Discard new schedule";
  node.querySelector(".remove-window").addEventListener("click", deleteEditing);
  const body = document.getElementById("editor-body");
  body.innerHTML = "";
  body.appendChild(node);
  updateEditorTitle();
  document.getElementById("editor-save-msg").textContent = "";
  document.getElementById("schedules-view").hidden = true;
  document.getElementById("schedule-editor").hidden = false;
  showTab("schedules");
  window.scrollTo(0, 0);
}

function closeEditor() {
  editing = null;
  openedFromList = false;
  document.getElementById("schedule-editor").hidden = true;
  document.getElementById("schedules-view").hidden = false;
  renderSchedules();
}

async function saveEditing() {
  const btn = document.getElementById("editor-save");
  const data = collectWindow(editing.node);
  const id = editing.id || windowIdFromName(data.name, new Set(windows.map((w) => w.id)));
  btn.disabled = true;
  try {
    const saved = await sendJSON(`api/windows/${encodeURIComponent(id)}`, "PUT", { id, ...data });
    const index = windows.findIndex((w) => w.id === id);
    if (index === -1) windows.push(saved);
    else windows[index] = saved;
    editing.baseline = JSON.stringify(data);
    leaveEditor();
    flashMsg("windows-save-msg", `Saved ${saved.name}`);
  } catch (e) {
    flashMsg("editor-save-msg", `Couldn't save: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function deleteEditing() {
  const name = document.getElementById("editor-title").textContent;
  if (editing.id) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await fetchJSON(`api/windows/${encodeURIComponent(editing.id)}`, { method: "DELETE" });
    } catch (e) {
      flashMsg("editor-save-msg", `Couldn't delete: ${e.message}`, true);
      return;
    }
    windows = windows.filter((w) => w.id !== editing.id);
    flashMsg("windows-save-msg", `Deleted ${name}`);
  }
  // Nothing left to lose, so leaving shouldn't ask about unsaved changes.
  editing.baseline = JSON.stringify(collectWindow(editing.node));
  leaveEditor();
}

function flashSaved(id) {
  flashMsg(id, "Saved");
}

function flashMsg(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle("error", isError);
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => (el.textContent = ""), isError ? 5000 : 2500);
}

// Pause state for all scheduling, as last loaded from or saved to the server.
let paused = false;

function renderPaused() {
  const btn = document.getElementById("pause-toggle");
  btn.textContent = paused ? "Resume scheduling" : "Pause scheduling";
  btn.classList.toggle("is-paused", paused);
  document.getElementById("paused-banner").hidden = !paused;
}

async function togglePaused() {
  const btn = document.getElementById("pause-toggle");
  btn.disabled = true;
  try {
    const result = await sendJSON("api/paused", "POST", { paused: !paused });
    paused = result.paused;
    renderPaused();
    refreshStatus();
  } catch (e) {
    alert(`Couldn't ${paused ? "resume" : "pause"} scheduling: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function loadConfig() {
  const cfg = await fetchJSON("api/config");
  savedEntities = { ...cfg.entities };
  document.getElementById("inverter-type").value = cfg.settings?.inverter_type || "sigenergy";
  renderEntityGrid();
  document.getElementById("battery-capacity").value = cfg.settings?.battery_capacity_kwh ?? "";
  windows = cfg.windows || [];
  // A restore replaces every schedule, so whatever was open in the editor is gone.
  if (editing) {
    history.replaceState(null, "", location.pathname + location.search);
    closeEditor();
  } else {
    renderSchedules();
  }
  paused = !!cfg.paused;
  renderPaused();
}

async function loadProfiles() {
  profiles = await fetchJSON("api/profiles");
  const select = document.getElementById("inverter-type");
  Object.entries(profiles).forEach(([key, p]) => select.add(new Option(p.label, key)));
}

async function onInverterTypeChange() {
  // Saved straight away rather than waiting for "Save settings" - the UI
  // switches immediately, so the scheduler must too, or schedules saved
  // with the new inverter's modes get rejected against the old one.
  await saveSettings();
  // Re-render entity fields and the mode labels for the new inverter in
  // place, keeping anything typed but not yet saved.
  collectEntities();
  renderEntityGrid();
  renderSchedules();
  if (editing) {
    const select = editing.node.querySelector(".w-ems-mode");
    fillModeOptions(select, select.value);
    updateModeVisibility(editing.node);
  }
}

async function saveEntities() {
  await sendJSON("api/entities", "POST", collectEntities());
  flashSaved("entities-save-msg");
}

async function saveSettings() {
  const raw = document.getElementById("battery-capacity").value;
  await sendJSON("api/settings", "POST", {
    inverter_type: document.getElementById("inverter-type").value,
    battery_capacity_kwh: raw === "" ? null : Number(raw),
  });
  flashSaved("settings-save-msg");
}

function showBackupMsg(text, isError = false) {
  const el = document.getElementById("backup-msg");
  el.textContent = text;
  el.classList.toggle("error", isError);
  if (!isError) setTimeout(() => (el.textContent = ""), 3000);
}

async function downloadBackup() {
  try {
    const resp = await fetch("api/backup");
    if (!resp.ok) throw new Error(`api/backup -> ${resp.status}`);
    // Build the file client-side rather than navigating to api/backup, so the
    // download works from inside the ingress iframe.
    const blob = await resp.blob();
    const match = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = match ? match[1] : "ems-manager-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    showBackupMsg("Backup downloaded");
  } catch (e) {
    showBackupMsg(`Backup failed: ${e.message}`, true);
  }
}

async function restoreBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    showBackupMsg("Restore failed: that file isn't valid JSON", true);
    return;
  }
  const count = Array.isArray(data.windows) ? data.windows.length : 0;
  if (!confirm(`Restore from "${file.name}"? This replaces your current entities, settings and all schedules with the ${count} schedule(s) in the backup.`)) {
    return;
  }
  const resp = await fetch("api/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      detail = (await resp.json()).detail || detail;
    } catch (e) {}
    showBackupMsg(`Restore failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, true);
    return;
  }
  await loadConfig();
  showBackupMsg("Restored");
}

async function refreshStatus() {
  try {
    const status = await fetchJSON("api/status");
    const pill = document.getElementById("status-pill");
    const body = document.getElementById("status-body");
    // The local pause flag, not status.paused - the status only catches up
    // on the scheduler's next poll, up to poll_interval_seconds later.
    if (paused) {
      pill.textContent = "paused";
      pill.style.color = "var(--warn)";
    } else if (status.last_run) {
      const names = status.active_window_names || [];
      pill.textContent = names.length ? names.join(", ") : "idle";
      pill.style.color = names.length ? "var(--good)" : "var(--muted)";
    } else {
      pill.textContent = "waiting for first run";
    }
    body.textContent = JSON.stringify(status, null, 2);

    activeIds = new Set(status.active_window_ids || []);
    document.querySelectorAll("#windows-list [data-row]").forEach((node) => {
      node.classList.toggle("is-active", activeIds.has(node.dataset.id));
    });
  } catch (e) {
    document.getElementById("status-pill").textContent = "unreachable";
  }
  // Also moves the timeline's "now" marker along.
  renderTimeline();
}

function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  // Default to the Schedules tab - it's the one you come back to most.
  showTab("schedules");
}

document.getElementById("save-entities").addEventListener("click", saveEntities);
document.getElementById("save-settings").addEventListener("click", saveSettings);
document.getElementById("pause-toggle").addEventListener("click", togglePaused);
document.getElementById("download-backup").addEventListener("click", downloadBackup);
document.getElementById("restore-backup").addEventListener("click", () => {
  document.getElementById("restore-file").click();
});
document.getElementById("restore-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  // Clear it so picking the same file again still fires "change".
  e.target.value = "";
  if (file) restoreBackup(file);
});
document.getElementById("add-window").addEventListener("click", () => openSchedule(null));
document.getElementById("reorder-toggle").addEventListener("click", () => {
  reorderMode = !reorderMode;
  renderSchedules();
});
document.querySelectorAll("#day-picker button").forEach((btn) => {
  btn.addEventListener("click", () => {
    timelineDay = btn.dataset.day;
    renderTimeline();
  });
});
document.getElementById("editor-back").addEventListener("click", leaveEditor);
document.getElementById("editor-save").addEventListener("click", saveEditing);
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => {
  if (isDirty()) e.preventDefault();
});

document.getElementById("inverter-type").addEventListener("change", onInverterTypeChange);

// Status after config, so the pill knows whether scheduling is paused; the
// route after config too, so a #schedule-<id> address can find its schedule.
initTabs();
loadProfiles().then(loadConfig).then(route).then(refreshStatus);
setInterval(refreshStatus, 10000);
