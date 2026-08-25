const $ = (selector) => document.querySelector(selector);
const state = { events: [], archivedEvents: [], deliveries: [] };
const REMINDERS_API_PATH = "/api/reminders";
const ARCHIVE_API_PATH = "/api/archive";

const loginView = $("#login-view");
const appView = $("#app-view");
const dialog = $("#event-dialog");

document.addEventListener("DOMContentLoaded", initialize);
$("#login-form").addEventListener("submit", onLogin);
$("#logout-button").addEventListener("click", onLogout);
$("#test-button").addEventListener("click", onSendTest);
$("#refresh-button").addEventListener("click", loadDashboard);
$("#add-button").addEventListener("click", () => openEventDialog());
$("#archive-view-button").addEventListener("click", showArchive);
$("#schedule-view-button").addEventListener("click", showSchedule);
$("#event-form").addEventListener("submit", saveEvent);
$("#schedule-type").addEventListener("change", updateScheduleTypeControls);
$("#close-dialog").addEventListener("click", () => dialog.close());
$("#cancel-dialog").addEventListener("click", () => dialog.close());

async function initialize() {
  try {
    await api("/api/session");
    showDashboard();
    await loadDashboard();
  } catch {
    showLogin();
  }
}

async function onLogin(event) {
  event.preventDefault();
  const button = event.submitter;
  const error = $("#login-error");
  error.textContent = "";
  button.disabled = true;
  try {
    await api("/api/login", {
      method: "POST",
      body: { password: $("#password").value },
    });
    $("#password").value = "";
    showDashboard();
    await loadDashboard();
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    button.disabled = false;
  }
}

async function onLogout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  showLogin();
}

async function onSendTest() {
  const button = $("#test-button");
  button.disabled = true;
  try {
    await api("/api/send-test", { method: "POST" });
    toast("Test message sent to Discord.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadDashboard() {
  const dashboardError = $("#dashboard-error");
  dashboardError.textContent = "";
  dashboardError.classList.add("hidden");

  try {
    const [eventsResult, archiveResult, deliveriesResult] = await Promise.all([
      api(REMINDERS_API_PATH),
      api(ARCHIVE_API_PATH),
      api("/api/deliveries"),
    ]);
    state.events = eventsResult.events;
    state.archivedEvents = archiveResult.events;
    state.deliveries = deliveriesResult.deliveries;
    renderEvents();
    renderArchive();
    renderDeliveries();
    renderSummary();
  } catch (error) {
    if (error.status === 401) showLogin();
    else {
      const message = `Dashboard data could not be loaded: ${error.message}`;
      dashboardError.textContent = message;
      dashboardError.classList.remove("hidden");
      toast(message);
    }
  }
}

function renderEvents() {
  const list = $("#events-list");
  list.replaceChildren();
  $("#events-empty").classList.toggle("hidden", state.events.length > 0);

  for (const event of state.events) {
    const card = element("article", "event-card");
    const identity = element("div");
    const name = element("div", "event-name");
    name.append(element("span", `status-dot${event.enabled ? "" : " off"}`));
    name.append(document.createTextNode(event.name));
    name.append(element(
      "span",
      `schedule-badge ${event.schedule_type}`,
      event.schedule_type === "one_time" ? "One time" : "Recurring",
    ));
    identity.append(name);
    const scheduleSummary = event.schedule_type === "one_time"
      ? oneTimeStatus(event)
      : event.enabled ? `Every ${event.interval_days} days` : "Disabled";
    identity.append(element("div", "event-meta", scheduleSummary));

    const time = element("div", "event-time");
    time.append(element("strong", "", formatUtc(event.next_start_at)));
    time.append(element(
      "div",
      "event-meta",
      event.schedule_type === "one_time"
        ? `Exact UTC occurrence · reminder ${event.reminder_minutes} min before`
        : `Reminder ${event.reminder_minutes} min before`,
    ));

    const message = element("div", "event-meta", event.message);
    const actions = element("div", "event-actions");
    const edit = element("button", "ghost", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openEventDialog(event));
    const archive = element("button", "danger", "Archive");
    archive.type = "button";
    archive.addEventListener("click", () => archiveEvent(event));
    actions.append(edit, archive);
    card.append(identity, time, message, actions);
    list.append(card);
  }
}

function renderArchive() {
  const list = $("#archive-list");
  list.replaceChildren();
  $("#archive-empty").classList.toggle("hidden", state.archivedEvents.length > 0);
  $("#archive-view-button").textContent = `Archive (${state.archivedEvents.length})`;

  for (const event of state.archivedEvents) {
    const card = element("article", "event-card archived");
    const identity = element("div");
    const name = element("div", "event-name");
    name.append(element("span", "status-dot off"));
    name.append(document.createTextNode(event.name));
    name.append(element(
      "span",
      `schedule-badge ${event.schedule_type}`,
      event.schedule_type === "one_time" ? "One time" : "Recurring",
    ));
    identity.append(name);
    identity.append(element(
      "div",
      "event-meta",
      `${event.archived_reason === "expired" ? "Expired" : "Archived"} · ${formatUtc(event.archived_at)}`,
    ));

    const time = element("div", "event-time");
    time.append(element("strong", "", formatUtc(event.next_start_at)));
    time.append(element(
      "div",
      "event-meta",
      event.schedule_type === "one_time"
        ? "Exact archived occurrence"
        : `Every ${event.interval_days} days`,
    ));

    const message = element("div", "event-meta", event.message);
    const actions = element("div", "event-actions");
    const restore = element("button", "ghost", "Restore");
    restore.type = "button";
    restore.addEventListener("click", () => openEventDialog(event, "restore"));
    const remove = element("button", "danger", "Delete permanently");
    remove.type = "button";
    remove.addEventListener("click", () => permanentlyDeleteEvent(event));
    actions.append(restore, remove);
    card.append(identity, time, message, actions);
    list.append(card);
  }
}

function renderDeliveries() {
  const body = $("#deliveries-body");
  body.replaceChildren();
  $("#deliveries-empty").classList.toggle("hidden", state.deliveries.length > 0);
  $(".table-wrap").classList.toggle("hidden", state.deliveries.length === 0);

  for (const delivery of state.deliveries) {
    const row = document.createElement("tr");
    const eventCell = element("td", "", delivery.event_name);
    const scheduledCell = element("td", "", formatUtc(delivery.scheduled_for));
    const statusCell = document.createElement("td");
    statusCell.append(element("span", `badge ${delivery.status}`, delivery.status));
    const attemptedCell = element("td", "", formatUtc(delivery.attempted_at));
    if (delivery.error) attemptedCell.title = delivery.error;
    row.append(eventCell, scheduledCell, statusCell, attemptedCell);
    body.append(row);
  }
}

function renderSummary() {
  const active = state.events.filter((event) => event.enabled);
  $("#active-count").textContent = String(active.length);
  $("#next-reminder").textContent = active.length
    ? formatUtc(active.sort((a, b) => Date.parse(a.next_reminder_at) - Date.parse(b.next_reminder_at))[0].next_reminder_at)
    : "None scheduled";
  const sent = state.deliveries.find((delivery) => delivery.status === "sent");
  $("#last-delivery").textContent = sent ? `${sent.event_name} · ${formatUtc(sent.sent_at)}` : "No deliveries yet";
}

function openEventDialog(event = null, action = "save") {
  const restoring = action === "restore";
  $("#dialog-title").textContent = restoring
    ? "Restore reminder"
    : event ? "Edit event" : "Add event";
  $("#event-id").value = event?.id ?? "";
  $("#event-action").value = action;
  $("#event-name").value = event?.name ?? "";
  $("#schedule-type").value = event?.schedule_type ?? "recurring";
  $("#anchor-date").value = event?.anchor_date ?? new Date().toISOString().slice(0, 10);
  $("#start-time").value = event?.start_time_utc ?? "15:00";
  $("#interval-days").value = event?.interval_days ?? 2;
  $("#reminder-minutes").value = event?.reminder_minutes ?? 10;
  $("#event-message").value = event?.message ?? "";
  $("#event-enabled").checked = restoring ? true : event?.enabled ?? true;
  $("#save-event-button").textContent = restoring ? "Restore reminder" : "Save event";
  const occurrenceExpired = event?.schedule_type === "one_time"
    && Date.parse(`${event.anchor_date}T${event.start_time_utc}:00.000Z`) <= Date.now();
  const guidance = $("#restore-guidance");
  guidance.textContent = restoring && occurrenceExpired
    ? "This one-time occurrence has expired. Choose a future date or time before restoring it."
    : restoring
      ? "Review the schedule settings before restoring this reminder."
      : "";
  guidance.classList.toggle("hidden", !restoring);
  $("#form-error").textContent = "";
  updateScheduleTypeControls();
  dialog.showModal();
  $("#event-name").focus();
}

async function saveEvent(event) {
  event.preventDefault();
  const button = event.submitter;
  const id = $("#event-id").value;
  const restoring = $("#event-action").value === "restore";
  const payload = {
    name: $("#event-name").value,
    schedule_type: $("#schedule-type").value,
    anchor_date: $("#anchor-date").value,
    start_time_utc: $("#start-time").value,
    interval_days: Number($("#interval-days").value),
    reminder_minutes: Number($("#reminder-minutes").value),
    message: $("#event-message").value,
    enabled: $("#event-enabled").checked,
  };

  button.disabled = true;
  $("#form-error").textContent = "";
  try {
    const path = restoring
      ? `${ARCHIVE_API_PATH}/${id}`
      : id ? `${REMINDERS_API_PATH}/${id}` : REMINDERS_API_PATH;
    await api(path, {
      method: restoring || id ? "PUT" : "POST",
      body: payload,
    });
    dialog.close();
    toast(restoring ? "Reminder restored." : id ? "Event updated." : "Event added.");
    await loadDashboard();
  } catch (error) {
    $("#form-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function updateScheduleTypeControls() {
  const oneTime = $("#schedule-type").value === "one_time";
  $("#interval-field").classList.toggle("hidden", oneTime);
  $("#interval-days").disabled = oneTime;
  $("#interval-days").required = !oneTime;
  $("#date-label-text").textContent = oneTime
    ? "Event date (UTC)"
    : "First event date (UTC)";
}

function oneTimeStatus(event) {
  if (event.terminal_status === "completed") return "Completed";
  if (event.terminal_status === "failed") return "Failed after maximum retries";
  return event.enabled ? "Scheduled once" : "Disabled";
}

async function archiveEvent(event) {
  if (!confirm(`Archive “${event.name}”? Its delivery history will be retained.`)) return;
  try {
    await api(`${REMINDERS_API_PATH}/${event.id}`, { method: "DELETE" });
    toast("Reminder archived.");
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

async function permanentlyDeleteEvent(event) {
  if (!confirm(`Permanently delete “${event.name}”? Its delivery history will be retained.`)) return;
  try {
    await api(`${ARCHIVE_API_PATH}/${event.id}`, { method: "DELETE" });
    toast("Reminder permanently deleted. Delivery history retained.");
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

function showArchive() {
  $("#schedule-panel").classList.add("hidden");
  $("#archive-panel").classList.remove("hidden");
}

function showSchedule() {
  $("#archive-panel").classList.add("hidden");
  $("#schedule-panel").classList.remove("hidden");
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (cause) {
    throw new Error(`Could not reach ${path}: ${cause?.message || "network request failed"}`, { cause });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showDashboard() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function showLogin() {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  $("#password").focus();
}

function formatUtc(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)) + " UTC";
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add("hidden"), 3500);
}
