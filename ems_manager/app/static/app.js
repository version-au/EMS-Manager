// Per-inverter entity lists and EMS modes, from profiles.py via api/profiles.
let profiles = {};
// Every entity mapping saved so far, including ones for fields the current
// inverter doesn't show, so switching inverter type and back loses nothing.
let savedEntities = {};

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

function updateSummaryBadges(node) {
  const start = node.querySelector(".w-start").value;
  const end = node.querySelector(".w-end").value;
  node.querySelector(".w-time-badge").textContent = start && end ? `${start}–${end}` : "no time set";
  const mode = node.querySelector(".w-ems-mode").value;
  node.querySelector(".w-mode-badge").textContent = mode ? modeLabel(mode) : "no mode set";
}

let entityDatalistBuilt = false;

async function fetchJSON(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error(`${url} -> ${resp.status}`);
  return resp.json();
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

function renderWindow(win) {
  const tpl = document.getElementById("window-template");
  const node = tpl.content.firstElementChild.cloneNode(true);
  // Only set dataset.id when win.id actually exists - a brand-new window
  // (from "+ Add schedule") has no id yet, and dataset always stringifies,
  // so `node.dataset.id = win.id` with win.id === undefined would silently
  // store the literal text "undefined" instead of leaving it unset.
  if (win.id) node.dataset.id = win.id;

  node.querySelector(".w-name").value = win.name || "";
  node.querySelector(".w-enabled").checked = win.enabled !== false;
  updateEnabledLook(node);
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

  const days = win.days || ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  node.querySelectorAll("[data-days] input").forEach((cb) => {
    cb.checked = days.includes(cb.value);
  });

  updateModeVisibility(node);
  updateSummaryBadges(node);
  node.querySelector(".w-ems-mode").addEventListener("change", () => {
    updateModeVisibility(node);
    updateSummaryBadges(node);
  });
  node.querySelector(".w-start").addEventListener("change", () => updateSummaryBadges(node));
  node.querySelector(".w-end").addEventListener("change", () => updateSummaryBadges(node));

  node.querySelector(".w-enabled").addEventListener("change", () => onEnabledToggle(node));

  node.querySelector(".expand-toggle").addEventListener("click", () => {
    node.classList.toggle("expanded");
  });

  node.querySelector(".remove-window").addEventListener("click", () => {
    node.remove();
  });

  node.querySelector(".move-up").addEventListener("click", () => {
    const prev = node.previousElementSibling;
    if (prev) node.parentElement.insertBefore(node, prev);
  });

  node.querySelector(".move-down").addEventListener("click", () => {
    const next = node.nextElementSibling;
    if (next) node.parentElement.insertBefore(next, node);
  });

  return node;
}

function updateEnabledLook(node) {
  const enabled = node.querySelector(".w-enabled").checked;
  node.classList.toggle("is-disabled", !enabled);
  node.querySelector(".switch-text").textContent = enabled ? "On" : "Off";
}

async function onEnabledToggle(node) {
  const checkbox = node.querySelector(".w-enabled");
  const enabled = checkbox.checked;
  updateEnabledLook(node);
  // A schedule that's never been saved has nothing on the server to flip
  // yet - its state goes in with the next "Save schedules".
  if (!node.dataset.id) {
    flashMsg("windows-save-msg", "New schedule - click Save schedules to keep it");
    return;
  }
  checkbox.disabled = true;
  try {
    await fetchJSON(`api/windows/${encodeURIComponent(node.dataset.id)}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const name = node.querySelector(".w-name").value.trim() || "Schedule";
    flashMsg("windows-save-msg", `${name} turned ${enabled ? "on" : "off"}`);
  } catch (e) {
    checkbox.checked = !enabled;
    updateEnabledLook(node);
    flashMsg("windows-save-msg", `Couldn't save: ${e.message}`, true);
  } finally {
    checkbox.disabled = false;
  }
}

function renderWindows(windows) {
  const list = document.getElementById("windows-list");
  list.innerHTML = "";
  windows.forEach((w) => list.appendChild(renderWindow(w)));
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

function collectWindows() {
  const existingIds = new Set();
  return [...document.querySelectorAll("#windows-list [data-window]")].map((node) => {
    const name = node.querySelector(".w-name").value.trim() || "Untitled";
    const id = node.dataset.id || windowIdFromName(name, existingIds);
    existingIds.add(id);

    const num = (sel) => {
      const v = node.querySelector(sel).value;
      return v === "" ? null : Number(v);
    };

    return {
      id,
      name,
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
  });
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
    const result = await fetchJSON("api/paused", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: !paused }),
    });
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
  renderWindows(cfg.windows || []);
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
  // Re-render entity fields and each schedule's mode list for the new
  // inverter in place, keeping anything typed but not yet saved.
  collectEntities();
  renderEntityGrid();
  document.querySelectorAll("#windows-list [data-window]").forEach((node) => {
    const select = node.querySelector(".w-ems-mode");
    fillModeOptions(select, select.value);
    updateModeVisibility(node);
    updateSummaryBadges(node);
  });
}

async function saveEntities() {
  await fetchJSON("api/entities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectEntities()),
  });
  flashSaved("entities-save-msg");
}

async function saveSettings() {
  const raw = document.getElementById("battery-capacity").value;
  await fetchJSON("api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inverter_type: document.getElementById("inverter-type").value,
      battery_capacity_kwh: raw === "" ? null : Number(raw),
    }),
  });
  flashSaved("settings-save-msg");
}

async function saveWindows() {
  const nodes = [...document.querySelectorAll("#windows-list [data-window]")];
  const windows = collectWindows();
  await fetchJSON("api/windows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windows }),
  });
  // Brand-new schedules only get an id in collectWindows(); keep it on the
  // row so its On/Off switch can save on its own from now on.
  nodes.forEach((node, i) => (node.dataset.id = windows[i].id));
  flashSaved("windows-save-msg");
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

    const activeIds = new Set(status.active_window_ids || []);
    document.querySelectorAll("#windows-list [data-window]").forEach((node) => {
      node.classList.toggle("is-active", activeIds.has(node.dataset.id));
    });
  } catch (e) {
    document.getElementById("status-pill").textContent = "unreachable";
  }
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
    });
  });
  // Default to the Schedules tab - it's the one you come back to most.
  document.querySelector('.tab-btn[data-tab="schedules"]').click();
}

document.getElementById("save-entities").addEventListener("click", saveEntities);
document.getElementById("save-settings").addEventListener("click", saveSettings);
document.getElementById("save-windows").addEventListener("click", saveWindows);
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
document.getElementById("add-window").addEventListener("click", () => {
  const node = renderWindow({ name: "", start: "00:00", end: "00:00", enabled: true });
  node.classList.add("expanded");
  document.getElementById("windows-list").appendChild(node);
});

document.getElementById("inverter-type").addEventListener("change", onInverterTypeChange);

// Status after config, so the pill knows whether scheduling is paused.
loadProfiles().then(loadConfig).then(refreshStatus);
initTabs();
setInterval(refreshStatus, 10000);
