const $ = (s, root = document) => root.querySelector(s);
const app = $("#app"),
  overlay = $("#overlay");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  pipeline: "M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v13h-4z",
  building: "M4 21V5l8-3v19 M12 8h8v13 M2 21h20 M7 7v2m0 3v2m0 3v2m9-7v2m0 3v2",
  chart: "M3 3v18h18 M7 14l4-4 4 3 6-8",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  alert: "M12 8v5m0 3v.1 M12 3 2 21h20z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  x: "m6 6 12 12M6 18 18 6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  filter: "M4 7h16M7 12h10M10 17h4",
  target: "M21 12a9 9 0 1 1-9-9 M12 7a5 5 0 1 0 5 5 M12 12l9-9m-4 0h4v4",
  mail: "M3 5h18v14H3z m0 0 9 7 9-7",
  logout: "M9 4H3v16h6 M10 12h11m-4-4 4 4-4 4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8z",
  external: "M14 3h7v7m0-7L10 14 M10 3H3v18h18v-7",
  menu: "M3 6h18M3 12h18M3 18h18",
  note: "M5 3h14v18H5z M8 7h8M8 11h8M8 15h5",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
let state,
  view = location.hash.slice(1) || "today",
  owner = "all",
  query = "",
  stageFilter = "Open",
  boardMode = "board",
  selectedDeal = null,
  lastFocus = null,
  importRows = null,
  importKind = "leads",
  importPreview = null;
const nav = [
  ["today", "sun", "Today"],
  ["leads", "users", "Leads"],
  ["pipeline", "pipeline", "Pipeline"],
  ["accounts", "building", "Accounts"],
  ["forecast", "chart", "Forecast"],
  ["reports", "grid", "Reports"],
];
const settings = () => state.workspace.settings;
const money = (n, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: settings().currency,
    maximumFractionDigits: compact ? 1 : 0,
    ...(compact ? { notation: "compact" } : {}),
  }).format(n || 0);
const member = (id) =>
  state.members.find((m) => m.id === id) || { name: "Unassigned" };
const account = (id) => state.data.accounts.find((a) => a.id === id);
const initial = (name) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const avatar = (id, size = "") =>
  `<span class="avatar ${size} tone-${
    Math.max(
      0,
      state.members.findIndex((m) => m.id === id),
    ) % 4
  }" title="${escape(member(id).name)}">${escape(initial(member(id).name))}</span>`;
const shortDate = (d) =>
  d
    ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "Not set";
const dateAfter = (n) => {
  const d = new Date(state.today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const open = (d) => !["Won", "Lost"].includes(d.stage);
const canWrite = () => state.user.role !== "viewer";
const manager = () => ["admin", "manager"].includes(state.user.role);
const filtered = (records) =>
  records.filter(
    (r) =>
      (owner === "all" || r.ownerId === owner) &&
      (!query ||
        `${r.name || r.title} ${r.company || ""} ${account(r.accountId)?.name || ""} ${r.email || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
function risks(d) {
  if (!open(d)) return [];
  const result = [];
  if (!d.nextStep) result.push("No next step");
  else if (d.nextDate && d.nextDate < state.today)
    result.push("Next step overdue");
  if (d.closeDate < state.today) result.push("Close date passed");
  if (!d.lastContact || d.lastContact < dateAfter(-settings().staleDays))
    result.push("No recent contact");
  if (
    state.data.tasks.some(
      (t) => t.dealId === d.id && !t.done && t.dueDate < state.today,
    )
  )
    result.push("Overdue task");
  return result;
}
const pill = (text, tone = "neutral") =>
  `<span class="pill ${tone}">${escape(text)}</span>`;
const stagePill = (stage) =>
  pill(
    stage,
    stage === "Won"
      ? "green"
      : stage === "Lost"
        ? "red"
        : stage === "Negotiation"
          ? "amber"
          : stage === "Proposal"
            ? "purple"
            : "neutral",
  );
async function api(path, method = "GET", data) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const value = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(value.error || "Request failed"), {
      status: res.status,
    });
  return value;
}
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `show ${error ? "error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ""), 5000);
}
async function refresh() {
  state = await api("/bootstrap");
  render();
}
const empty = (title, description, action = "") =>
  `<div class="empty">${icon("target")}<h3>${title}</h3><p>${description}</p>${action}</div>`;
const button = (label, action, cls = "", attrs = "") =>
  `<button class="btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;
function render() {
  if (!nav.some((n) => n[0] === view) && view !== "settings") view = "today";
  const pending = state.data.tasks.filter(
    (t) => !t.done && t.dueDate <= state.today,
  ).length;
  app.innerHTML = `<aside class="sidebar" ${matchMedia("(max-width:720px)").matches && !document.body.classList.contains("nav-open") ? "inert" : ""}><a href="#today" class="brand"><span class="brand-mark">${icon("chart")}</span>SalesScope<span class="brand-dot">.</span></a><button class="workspace-switch" data-action="navigate" data-view="settings"><span class="workspace-icon">${escape(initial(settings().name))}</span><span><b>${escape(settings().name)}</b><small>${state.workspace.demo ? "Demo workspace" : "Your workspace"}</small></span>${icon("down")}</button><p class="nav-label">WORKSPACE</p><nav aria-label="Main navigation">${nav.map(([id, i, name]) => `<a href="#${id}" class="nav-item ${view === id ? "active" : ""}" ${view === id ? 'aria-current="page"' : ""}>${icon(i)}<span>${name}</span>${id === "today" && pending ? `<span class="nav-count">${pending}</span>` : ""}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="focus-note"><span class="tiny-stars">✦</span><b>A little clarity. A lot of momentum.</b><p>Your next great deal starts with your next move.</p></div><a href="#settings" class="nav-item ${view === "settings" ? "active" : ""}">${icon("settings")}<span>Settings & data</span></a><button class="user-profile" data-action="account-menu">${avatar(state.user.id)}<span><b>${escape(state.user.name)}</b><small>${state.user.role === "admin" ? "Workspace admin" : escape(state.user.role)}</small></span>${icon("more")}</button></div></aside><div class="workspace"><header class="topbar"><button class="icon-button mobile-menu" data-action="menu" aria-label="Toggle navigation" aria-expanded="${document.body.classList.contains("nav-open")}">${icon("menu")}</button><div class="breadcrumb">Workspace <span>/</span> <b>${nav.find((n) => n[0] === view)?.[2] || "Settings"}</b></div><div class="top-actions"><button class="search-launch" data-action="search" aria-label="Search workspace">${icon("search")}<span>Search anything</span><kbd>Ctrl K</kbd></button><span class="top-divider"></span><button class="icon-button" data-action="navigate" data-view="today" aria-label="Open today's tasks">${icon("clock")}${pending ? '<i class="notification-dot"></i>' : ""}</button>${avatar(state.user.id, "small")}</div></header><main id="main" tabindex="-1">${{ today: todayPage, leads: leadsPage, pipeline: pipelinePage, accounts: accountsPage, forecast: forecastPage, reports: reportsPage, settings: settingsPage }[view]()}</main><footer class="app-footer"><span><i class="status-dot"></i> ${state.workspace.demo ? "Synthetic demo data" : "Private local workspace"} · Saved to this server</span><span>SalesScope <b>2.0</b></span></footer></div>`;
  document.title = `${nav.find((n) => n[0] === view)?.[2] || "Settings"} · SalesScope`;
}
function heading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="page-description">${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function periodLabel() {
  const d = new Date(state.today + "T12:00:00Z");
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}
function metricCards() {
  const m = state.metrics;
  return `<div class="metric-grid"><button class="metric-card" data-action="navigate" data-view="pipeline"><span class="metric-label">Open pipeline ${icon("pipeline")}</span><strong>${money(m.open)}</strong><span class="metric-bottom"><b class="text-purple">${m.openCount} active deals</b><span>All close dates</span></span></button><button class="metric-card" data-action="navigate" data-view="forecast"><span class="metric-label">Booked this quarter ${icon("chart")}</span><strong>${money(m.booked)}</strong><span class="metric-bottom"><b class="text-green">${m.wonCount} deals won</b><span>${periodLabel()}</span></span></button><button class="metric-card" data-action="navigate" data-view="reports"><span class="metric-label">Win rate ${icon("target")}</span><strong>${m.winRate === null ? "—" : `${Math.round(m.winRate)}<small>%</small>`}</strong><span class="metric-bottom"><b>${m.winRate === null ? "No closed deals" : "Won ÷ closed deals"}</b><span>This quarter</span></span></button><button class="metric-card" data-action="attention"><span class="metric-label">Deals needing attention ${icon("alert")}</span><strong>${state.data.deals.filter((d) => risks(d).length).length}<span class="metric-signal amber">Follow up</span></strong><span class="metric-bottom"><b class="text-amber">Keep your momentum</b><span>View deals ${icon("arrow")}</span></span></button></div>`;
}
function pipelineBars() {
  const openStages = settings().stages.filter(
      (s) => !["Won", "Lost"].includes(s),
    ),
    max = Math.max(
      ...openStages.map((s) =>
        state.data.deals
          .filter((d) => d.stage === s)
          .reduce((n, d) => n + d.amount, 0),
      ),
      1,
    );
  return `<div class="pipeline-bars">${openStages
    .map((s, i) => {
      const deals = state.data.deals.filter((d) => d.stage === s),
        total = deals.reduce((n, d) => n + d.amount, 0);
      return `<button class="pipeline-bar-row" data-action="stage-view" data-stage="${escape(s)}"><span>${escape(s)} <small>${deals.length}</small></span><div class="bar-track"><div class="bar-fill shade-${i % 4}" style="width:${Math.max(2, (total / max) * 100)}%"></div></div><b>${money(total, true)}</b></button>`;
    })
    .join("")}</div>`;
}
function goalCard() {
  const m = state.metrics,
    pct = settings().target
      ? Math.round((m.booked / settings().target) * 100)
      : 0;
  return `<section class="goal-card"><div class="card-title"><span>${icon("target")} THE QUARTER, IN FOCUS</span>${pill(periodLabel(), "dark-pill")}</div><div class="goal-value">${money(m.booked)} <small>of ${money(settings().target)}</small></div><p>Booked revenue toward your team target</p><div class="goal-track"><span style="width:${Math.min(pct, 100)}%"></span></div><div class="goal-labels"><b>${pct}% achieved</b><span>${money(m.gap)} to go</span></div><div class="goal-bottom"><span class="goal-orb">${icon("bolt")}</span><p>${m.quarterPipeline ? `<strong>${money(m.quarterPipeline, true)} in play this quarter.</strong><br>Keep the right conversations moving.` : "<strong>Your next chapter starts here.</strong><br>Add your first deal to build momentum."}</p><button class="icon-button" data-action="navigate" data-view="forecast" aria-label="View forecast">${icon("arrow")}</button></div></section>`;
}
function taskRow(t) {
  const d = state.data.deals.find((d) => d.id === t.dealId);
  return `<div class="task-row ${t.done ? "completed" : ""}"><button class="task-check ${t.done ? "checked" : ""}" data-action="task-toggle" data-id="${t.id}" aria-label="${t.done ? "Reopen" : "Complete"} ${escape(t.title)}" ${canWrite() ? "" : "disabled"}>${t.done ? icon("check") : ""}</button><div class="task-copy"><button class="text-button" data-action="${d ? "deal" : "edit-task"}" data-id="${d?.id || t.id}">${escape(t.title)}</button><span>${escape(d ? account(d.accountId)?.name || d.name : "General task")} <i>·</i> ${escape(member(t.ownerId).name.split(" ")[0])}</span></div><span class="due ${!t.done && t.dueDate < state.today ? "overdue" : ""}">${t.dueDate === state.today ? "Today" : shortDate(t.dueDate)}</span><button class="icon-button subtle" data-action="edit-task" data-id="${t.id}" aria-label="Edit task">${icon("more")}</button></div>`;
}
function todayPage() {
  const tasks = state.data.tasks
      .filter((t) => !t.done)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    risk = state.data.deals
      .filter((d) => risks(d).length)
      .sort((a, b) => b.amount - a.amount);
  return `${heading(new Date(state.today + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), `Your next move, in focus<span class="title-dot">.</span>`, "A clearer picture of your pipeline. A more purposeful day.", `${button(icon("upload") + " Import data", "import", "secondary")}${canWrite() ? button(icon("plus") + " New deal", "new-deal", "primary") : ""}`)}${metricCards()}<div class="overview-grid"><section class="card pipeline-overview"><div class="section-head"><div><h2>Pipeline overview</h2><p>Where your next wins are taking shape</p></div>${button("View pipeline " + icon("arrow"), "navigate", "text-link", 'data-view="pipeline"')}</div>${pipelineBars()}<div class="chart-caption"><span><i class="legend-dot"></i> Open deal value</span><span>${state.metrics.openCount} opportunities across ${settings().stages.length - 2} stages</span></div></section>${goalCard()}</div><div class="work-grid"><section class="card"><div class="section-head"><div class="title-row"><h2>${manager() ? "Team action list" : "Your action list"}</h2><span class="count-badge">${tasks.length}</span></div>${canWrite() ? button(icon("plus") + " Add task", "new-task", "text-link") : ""}</div><div class="section-subline"><span>Small steps. Meaningful progress.</span>${pill(`${tasks.filter((t) => t.dueDate < state.today).length} overdue`, "amber")}</div><div class="task-list">${tasks.slice(0, 5).map(taskRow).join("") || empty("A clear slate", "Add a next step to keep your deals moving.")}</div><button class="card-footer-button" data-action="all-tasks">View all tasks ${icon("arrow")}</button></section><section class="card attention-card"><div class="section-head"><div class="title-row"><span class="attention-icon">${icon("bolt")}</span><h2>Worth your attention</h2></div><span class="subtle-label">${risk.length} DEALS</span></div><p class="section-subline">A timely nudge can make all the difference.</p>${
    risk
      .slice(0, 3)
      .map(
        (d) =>
          `<button class="attention-row" data-action="deal" data-id="${d.id}"><span class="company-avatar c-${state.data.accounts.findIndex((a) => a.id === d.accountId) % 4}">${escape(initial(account(d.accountId)?.name || d.name))}</span><span><b>${escape(account(d.accountId)?.name || d.name)}</b><small>${escape(risks(d)[0])} <i>·</i> ${escape(d.stage)}</small></span><strong>${money(d.amount, true)}</strong>${icon("chevron")}</button>`,
      )
      .join("") ||
    empty("Looking good", "No active deals match your risk rules.")
  }<div class="insight-note">${icon("note")}<span>Every signal has a reason. Open a deal to see the context and take the next step.</span></div></section></div><section class="card recent-deals"><div class="section-head"><div><h2>Deals on your radar</h2><p>A few conversations to keep moving</p></div>${button("See all deals " + icon("arrow"), "navigate", "text-link", 'data-view="pipeline"')}</div>${dealsTable(state.data.deals.filter(open).slice(0, 4))}</section>`;
}
function toolbar(extra = "") {
  return `<div class="toolbar"><label class="input-search">${icon("search")}<input id="filter-query" placeholder="Search ${view}…" value="${escape(query)}" aria-label="Search ${view}"></label><div class="toolbar-right"><label class="select-wrap">${icon("users")}<select id="owner-filter" aria-label="Filter by owner"><option value="all">All owners</option>${state.members.map((m) => `<option value="${m.id}" ${owner === m.id ? "selected" : ""}>${escape(m.name)}</option>`).join("")}</select></label>${extra}</div></div>`;
}
function dealsTable(deals) {
  return deals.length
    ? `<div class="table-scroll"><table><thead><tr><th>DEAL / COMPANY</th><th>VALUE</th><th>STAGE</th><th>OWNER</th><th>EXPECTED CLOSE</th><th>NEXT STEP</th><th></th></tr></thead><tbody>${deals.map((d) => `<tr><td><button class="record-name" data-action="deal" data-id="${d.id}">${escape(d.name)}</button><small class="cell-sub">${escape(account(d.accountId)?.name || "No account linked")}</small></td><td class="number">${money(d.amount)}</td><td>${stagePill(d.stage)}</td><td>${avatar(d.ownerId, "small")}</td><td>${shortDate(d.closeDate)}</td><td><span class="next-step ${risks(d).length ? "text-amber" : ""}">${risks(d).length ? icon("clock") : icon("check")}${escape(d.nextStep || "Add a next step")}</span></td><td><button class="icon-button" data-action="deal" data-id="${d.id}" aria-label="Open ${escape(d.name)}">${icon("chevron")}</button></td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "No deals in this view",
        "Try another filter or add a new opportunity.",
        canWrite() ? button("Create a deal", "new-deal", "primary") : "",
      );
}
function pipelinePage() {
  const deals = filtered(state.data.deals).filter(
    (d) =>
      stageFilter === "All" ||
      (stageFilter === "Needs attention" && risks(d).length) ||
      (stageFilter === "Open" && open(d)) ||
      d.stage === stageFilter,
  );
  return `${heading("BUILD MOMENTUM", "A pipeline with perspective.", "Follow every opportunity from first conversation to a confident close.", `${button(icon("download") + " Export", "export-deals", "secondary")}${canWrite() ? button(icon("plus") + " New deal", "new-deal", "primary") : ""}`)}<div class="pipeline-summary"><b>${money(deals.reduce((n, d) => n + d.amount, 0))}</b><span>across ${deals.length} deals</span><i></i><span>${deals.filter((d) => risks(d).length).length} need attention</span></div><section class="card pipeline-workspace"><div class="saved-views"><span>YOUR VIEWS</span><button data-action="reset-view" class="view-chip">All opportunities</button>${state.data.views.map((v) => `<button class="view-chip" data-action="load-view" data-id="${v.id}">${escape(v.name)}</button>`).join("")}${canWrite() ? button(icon("plus") + " Save view", "save-view", "text-link") : ""}</div>${toolbar(`<select id="stage-filter" aria-label="Filter stages">${["Open", "Needs attention", "All", ...settings().stages].map((s) => `<option ${s === stageFilter ? "selected" : ""}>${escape(s)}</option>`).join("")}</select><div class="segmented"><button data-action="board-mode" data-mode="board" class="${boardMode === "board" ? "selected" : ""}" aria-label="Board view">${icon("pipeline")}</button><button data-action="board-mode" data-mode="table" class="${boardMode === "table" ? "selected" : ""}" aria-label="Table view">${icon("list")}</button></div>`)}${
    boardMode === "table"
      ? dealsTable(deals)
      : `<div class="kanban">${settings()
          .stages.filter(
            (s) =>
              stageFilter === "All" ||
              (["Open", "Needs attention"].includes(stageFilter) &&
                !["Won", "Lost"].includes(s)) ||
              stageFilter === s,
          )
          .map((s, i) => {
            const rows = deals.filter((d) => d.stage === s);
            return `<section class="kanban-column"><header><span><i class="stage-dot shade-${i % 4}"></i><b>${escape(s)}</b><small>${rows.length}</small></span><strong>${money(
              rows.reduce((n, d) => n + d.amount, 0),
              true,
            )}</strong></header><div class="kanban-cards">${rows.map((d) => `<button class="deal-card" data-action="deal" data-id="${d.id}"><span class="deal-company"><span class="company-avatar small c-${i % 4}">${escape(initial(account(d.accountId)?.name || d.name))}</span>${escape(account(d.accountId)?.name || "Opportunity")}</span><h3>${escape(d.name)}</h3><strong>${money(d.amount)}</strong><div class="deal-next ${risks(d).length ? "risk" : ""}">${icon(risks(d).length ? "clock" : "check")}<span>${escape(risks(d)[0] || d.nextStep || d.stage)}</span></div><footer>${avatar(d.ownerId, "small")}<span>${icon("clock")}${shortDate(d.closeDate)}</span></footer></button>`).join("") || '<div class="column-empty">Room for your next opportunity</div>'}</div>${canWrite() ? button(icon("plus") + " Add deal", "new-deal", "column-add", `data-stage="${escape(s)}"`) : ""}</section>`;
          })
          .join("")}</div>`
  }</section><p class="page-footnote">Open a deal to change its stage, update the next step, or log a customer conversation. Every change is recorded.</p>`;
}
function leadsPage() {
  const rows = filtered(state.data.leads);
  return `${heading("START THE CONVERSATION", "Good things start here.", "Capture interest. Find the right fit. Turn a promising introduction into a deal.", `${button(icon("upload") + " Import leads", "import", "secondary")}${canWrite() ? button(icon("plus") + " New lead", "new-lead", "primary") : ""}`)}<div class="mini-stats">${["New", "Contacted", "Qualified", "Disqualified"].map((s) => `<div><span>${s}</span><b>${state.data.leads.filter((l) => l.status === s).length}</b></div>`).join("")}</div><section class="card">${toolbar()}${rows.length ? `<div class="table-scroll"><table><thead><tr><th>PERSON</th><th>COMPANY</th><th>SOURCE</th><th>STATUS</th><th>OWNER</th><th></th></tr></thead><tbody>${rows.map((l) => `<tr><td><button class="record-name" data-action="edit-lead" data-id="${l.id}">${escape(l.name)}</button><small class="cell-sub">${escape(l.email || "No email")}</small></td><td>${escape(l.company || "—")}</td><td>${pill(l.source || "Unspecified")}</td><td>${pill(l.status, l.status === "Qualified" ? "green" : "purple")}</td><td>${avatar(l.ownerId, "small")}</td><td>${l.convertedDealId ? button("Open deal " + icon("arrow"), "deal", "text-link", `data-id="${l.convertedDealId}"`) : canWrite() ? button("Qualify " + icon("arrow"), "convert", "text-link", `data-id="${l.id}"`) : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("Your next relationship starts here", "Create a lead or import a CSV to get started.")}</section>`;
}
function accountsPage() {
  const rows = filtered(state.data.accounts);
  return `${heading("RELATIONSHIPS THAT MATTER", "Know the people behind the pipeline.", "Keep companies, buying contacts, and opportunities connected.", `${canWrite() ? button(icon("plus") + " New contact", "new-contact", "secondary") + button(icon("plus") + " New account", "new-account", "primary") : ""}`)}${toolbar()}<div class="account-grid">${
    rows
      .map((a, i) => {
        const deals = state.data.deals.filter((d) => d.accountId === a.id),
          contacts = state.data.contacts.filter((c) => c.accountId === a.id);
        return `<button class="card account-card" data-action="account" data-id="${a.id}"><div class="account-card-top"><span class="company-avatar large c-${i % 4}">${escape(initial(a.name))}</span>${icon("external")}</div><h2>${escape(a.name)}</h2><p>${escape(a.industry || "Industry not set")}</p><div class="account-card-stats"><span><b>${money(
          deals.filter(open).reduce((n, d) => n + d.amount, 0),
          true,
        )}</b>open pipeline</span><span><b>${contacts.length}</b>contacts</span><span><b>${deals.length}</b>deals</span></div><footer>${avatar(a.ownerId, "small")}<span>${escape(member(a.ownerId).name)}</span></footer></button>`;
      })
      .join("") ||
    empty(
      "Make the connection",
      "Add your first company, then link its contacts and deals.",
    )
  }</div>`;
}
function forecastPage() {
  const m = state.metrics,
    latest = state.data.snapshots[0],
    changes = latest
      ? state.data.deals.flatMap((d) => {
          const old = latest.deals.find((x) => x.id === d.id);
          return old &&
            ["stage", "amount", "closeDate", "forecast"].some(
              (k) => old[k] !== d[k],
            )
            ? [{ d, old }]
            : [];
        })
      : [];
  return `${heading("LOOK AHEAD, WITH CONTEXT", "A forecast you can explain.", "Clear categories, visible assumptions, and a record of what changed.", manager() ? button(icon("plus") + " Save snapshot", "snapshot", "primary") : "")}${metricCards()}<div class="overview-grid"><section class="card forecast-card"><div class="section-head"><div><h2>${periodLabel()} outlook</h2><p>Bookings and mutually exclusive open-deal categories</p></div>${pill("Scenario estimates", "purple")}</div>${[
    ["Booked wins", m.booked, "green"],
    ["Commit outlook", m.commit, "purple"],
    ["Best-case outlook", m.bestCase, "amber"],
    ["Quarter target", settings().target, "neutral"],
  ]
    .map(
      ([label, n, tone]) =>
        `<div class="forecast-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${tone}" style="width:${Math.min(100, (n / Math.max(settings().target, m.bestCase, 1)) * 100)}%"></div></div><b>${money(n)}</b></div>`,
    )
    .join(
      "",
    )}<div class="insight-note">${icon("note")}<span>Commit = won + open Commit deals. Best case also includes open Best case deals. Open deals use expected close date; won deals use actual close date.</span></div></section>${goalCard()}</div><div class="work-grid"><section class="card"><div class="section-head"><h2>Since the last snapshot</h2>${latest ? pill(shortDate(latest.createdAt)) : ""}</div>${
    !latest
      ? empty(
          "Give your next review a baseline",
          "Save a snapshot to start tracking stage, value, close-date, and category changes.",
        )
      : changes.length
        ? changes
            .map(
              ({ d, old }) =>
                `<button class="change-row" data-action="deal" data-id="${d.id}"><b>${escape(d.name)}</b><span>${[
                  "stage",
                  "amount",
                  "closeDate",
                  "forecast",
                ]
                  .filter((k) => old[k] !== d[k])
                  .map(
                    (k) => `${escape(k)}: ${escape(old[k])} → ${escape(d[k])}`,
                  )
                  .join("<br>")}</span></button>`,
            )
            .join("")
        : empty(
            "You’re up to date",
            "No existing deals have changed since your latest snapshot.",
          )
  }</section><section class="card"><div class="section-head"><h2>Forecast history</h2><span class="subtle-label">POINT-IN-TIME RECORDS</span></div>${state.data.snapshots.length ? state.data.snapshots.map((s) => `<button class="snapshot-row" data-action="snapshot-detail" data-id="${s.id}"><span>${icon("note")}<b>${escape(s.name)}</b><small>${shortDate(s.createdAt)}</small></span><strong>${money(s.metrics.commit)}</strong></button>`).join("") : empty("Your story, over time", "Snapshots preserve the numbers and deal state from each review.")}</section></div>`;
}
function reportsPage() {
  const deals = state.data.deals,
    won = deals.filter((d) => d.stage === "Won"),
    lost = deals.filter((d) => d.stage === "Lost"),
    sources = [...new Set(deals.map((d) => d.source || "Unspecified"))];
  return `${heading("SEE THE BIGGER PICTURE", "From activity to understanding.", "Inspect the numbers, follow the evidence, and improve your sales process.", button(icon("download") + " Export deals", "export-deals", "secondary"))}${metricCards()}<div class="work-grid"><section class="card"><div class="section-head"><div><h2>Performance by source</h2><p>All recorded deals · closed-outcome win rate</p></div></div><div class="table-scroll"><table><thead><tr><th>SOURCE</th><th>DEALS</th><th>WON VALUE</th><th>WIN RATE</th></tr></thead><tbody>${sources
    .map((s) => {
      const rows = deals.filter((d) => (d.source || "Unspecified") === s),
        w = rows.filter((d) => d.stage === "Won"),
        closed = rows.filter((d) => !open(d));
      return `<tr><td>${escape(s)}</td><td>${rows.length}</td><td class="number">${money(w.reduce((n, d) => n + d.amount, 0))}</td><td>${closed.length ? Math.round((w.length / closed.length) * 100) + "%" : "—"}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div></section><section class="card"><div class="section-head"><div><h2>Team pipeline</h2><p>Open value and recorded outcomes</p></div></div>${state.members
    .map((m) => {
      const rows = deals.filter((d) => d.ownerId === m.id);
      return `<div class="team-report">${avatar(m.id)}<span><b>${escape(m.name)}</b><small>${rows.filter((d) => d.stage === "Won").length} won · ${rows.filter(open).length} open</small></span><strong>${money(rows.filter(open).reduce((n, d) => n + d.amount, 0))}</strong></div>`;
    })
    .join(
      "",
    )}</section></div><div class="work-grid"><section class="card"><div class="section-head"><h2>Why deals were lost</h2>${pill(`${lost.length} recorded outcomes`)}</div>${lost.length ? lost.map((d) => `<button class="change-row" data-action="deal" data-id="${d.id}"><b>${escape(d.name)}</b><span>${escape(d.lossReason || "No reason recorded")}</span></button>`).join("") : empty("No lost deals recorded", "Capture a reason when closing a deal to build useful context.")}</section><section class="card legacy-card"><span class="feature-icon">${icon("chart")}</span><h2>Go beyond the close.</h2><p>Your original transaction reporting is still here: revenue, cost, profit, customers, and product performance from sales files.</p><a class="btn secondary" href="/legacy/" target="_blank" rel="noopener">Open transaction reports ${icon("external")}</a><small>Separate report tool · uploaded files stay in your browser</small></section></div><div class="definition-note"><h3>Numbers with a clear meaning</h3><p>Booked wins are contract values, not collected cash. Dashboard metrics use ${periodLabel()}; source and team tables use all recorded deals. Stage counts are current inventory, not conversion rates. Predictive forecasts and historical cohort conversion require more data than a current pipeline snapshot.</p></div>`;
}
function settingsPage() {
  const s = settings();
  return `${heading("MAKE IT YOURS", "A workspace that fits your team.", "Set the rules, bring your data, and keep everyone working from the same picture.")}${state.workspaces?.length > 1 ? `<label class="workspace-selector">Switch workspace<select id="workspace-select">${options(state.workspaces, state.workspace.id)}</select></label>` : ""}<div class="settings-grid"><section class="card settings-card"><h2>Workspace preferences</h2><p>Your defaults for reporting and deal health.</p><form id="settings-form"><label>Workspace name<input name="name" value="${escape(s.name)}" required maxlength="100"></label><div class="form-grid"><label>Quarterly bookings target<input name="target" type="number" min="0" max="1000000000000" step="0.01" value="${s.target}" required></label><label>Reporting currency<select name="currency">${["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => `<option ${c === s.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label></div><label>Workspace timezone<select name="timezone">${["America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "UTC"].map((t) => `<option ${t === (s.timezone || "America/New_York") ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>Flag inactivity after (days)<input name="staleDays" type="number" min="1" max="365" value="${s.staleDays}" required></label><p class="field-help">Only logged customer interactions reset inactivity. Currency changes are blocked when deals exist to avoid relabeling money without conversion.</p><div class="form-error" role="alert"></div>${state.user.role === "admin" ? '<button class="btn primary" type="submit">Save preferences</button>' : pill("Admin access required")}</form></section><section class="card settings-card"><h2>Pipeline configuration</h2><p>Stage names and scenario probabilities for your sales process.</p><form id="pipeline-form"><label>Business template<select name="template">${["Services", "B2B software", "Manufacturing", "Commercial services"].map((t) => `<option ${t === s.template ? "selected" : ""}>${t}</option>`).join("")}</select></label>${state.user.role === "admin" ? button("Use template stages", "apply-template", "text-link") : ""}<div class="stage-settings">${s.stages.map((stage) => `<div><label>${escape(stage)}</label><span><input type="number" name="prob-${escape(stage)}" aria-label="${escape(stage)} probability" min="0" max="100" value="${Math.round((s.probabilities[stage] || 0) * 100)}" ${["Won", "Lost"].includes(stage) ? "readonly" : ""}>%</span></div>`).join("")}</div><label>Stages, in order (one per line)<textarea name="stages" rows="5" required>${escape(s.stages.join("\n"))}</textarea></label><p class="field-help">End with Won and Lost. Existing deals must be moved before removing their stage. New stages start at 20% probability.</p><div class="form-error" role="alert"></div>${state.user.role === "admin" ? '<button class="btn secondary" type="submit">Update pipeline</button>' : ""}</form></section><section class="card settings-card"><h2>Data & portability</h2><p>Bring a CSV, review the mapping, and confirm which rows will be added.</p><div class="settings-actions">${button(icon("upload") + " Import leads or deals", "import", "secondary")}${button(icon("download") + " Export workspace JSON", "export-workspace", "secondary")}${button(icon("download") + " Download lead template", "template", "secondary")}</div><div class="storage-note">${icon("check")}<div><b>Persistent local storage</b><p>Records and history are saved in this server’s SQLite database. CRM sync, automatic backups, and email delivery are not connected.</p></div></div></section><section class="card settings-card"><h2>Workspace members</h2><p>Admins and managers see the workspace. Representatives see their own records.</p>${state.members.map((m) => `<div class="team-report">${avatar(m.id)}<span><b>${escape(m.name)}</b><small>${escape(m.role)}</small></span>${m.id === state.user.id ? pill("You", "purple") : ""}</div>`).join("")}<p class="field-help">${state.workspace.demo ? "Demo teammates are sample owners, not active users. Create a private workspace for your own data." : "Invite links work for people who can reach this server. Account recovery is not enabled in this local release."}</p>${state.user.role === "admin" ? button(icon("plus") + " Invite teammate", "invite", "primary") : ""} ${button(state.workspace.demo ? "Create a private workspace" : "Manage sign-in", "account-menu", "secondary")}</section></div>`;
}
function showDialog(title, content, { wide = false, drawer = false } = {}) {
  lastFocus = document.activeElement;
  overlay.innerHTML = `<div class="modal-backdrop"><section class="dialog ${wide ? "wide" : ""} ${drawer ? "drawer" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon("x")}</button></header><div class="dialog-body">${content}</div></section></div>`;
  document.body.classList.add("modal-open");
  app.inert = true;
  setTimeout(
    () =>
      (
        $(
          '.dialog-body input:not([type="hidden"]), .dialog-body select, .dialog-body button',
        ) || $(".dialog-header button")
      )?.focus(),
    0,
  );
}
function closeDialog() {
  overlay.innerHTML = "";
  app.inert = false;
  document.body.classList.remove("modal-open");
  selectedDeal = null;
  lastFocus?.isConnected && lastFocus.focus();
}
function options(rows, value, blank = "") {
  return `${blank ? `<option value="">${blank}</option>` : ""}${rows.map((r) => `<option value="${escape(r.id ?? r)}" ${(r.id ?? r) === value ? "selected" : ""}>${escape(r.name ?? r)}</option>`).join("")}`;
}
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const select = (label, name, rows, value, blank = "") =>
  `<label>${label}<select name="${name}">${options(rows, value, blank)}</select></label>`;
const notes = (value) =>
  `<label>Notes<textarea name="notes" rows="3">${escape(value || "")}</textarea></label>`;
const owners = (value) =>
  select(
    "Owner",
    "ownerId",
    state.user.role === "rep"
      ? state.members.filter((m) => m.id === state.user.id)
      : state.members,
    value || state.user.id,
  );
function editForm(kind, id = null, stage = null) {
  const r = state.data[kind].find((r) => r.id === id) || {};
  if (r.convertedDealId) {
    showDeal(r.convertedDealId);
    return;
  }
  let html = "";
  if (kind === "deals")
    html =
      field("Deal name", "name", r.name, "text", 'required maxlength="300"') +
      `<div class="form-grid">${select("Account", "accountId", state.data.accounts, r.accountId, "No account linked")}${select("Buying contact", "contactId", state.data.contacts, r.contactId, "No contact linked")}${field(`Deal value (${settings().currency})`, "amount", r.amount ?? "", "number", 'required min="0" max="1000000000000" step="0.01"')}${select("Stage", "stage", settings().stages, r.stage || stage || settings().stages[0])}${owners(r.ownerId)}${field("Expected close", "closeDate", r.closeDate || dateAfter(30), "date", "required")}${select("Forecast category", "forecast", ["Pipeline", "Best case", "Commit", "Omitted"], r.forecast || "Pipeline")}${field("Source", "source", r.source || "Inbound")}</div><div class="form-divider"></div><h3>Keep the next step clear</h3>${field("Next action", "nextStep", r.nextStep)}<div class="form-grid">${field("Next action date", "nextDate", r.nextDate, "date")}${field("Last customer contact", "lastContact", r.lastContact, "date")}</div>${field("Loss reason (required when Lost)", "lossReason", r.lossReason)}${notes(r.notes)}`;
  if (kind === "leads")
    html = `<div class="form-grid">${field("Full name", "name", r.name, "text", "required")}${field("Company", "company", r.company)}${field("Email", "email", r.email, "email")}${field("Source", "source", r.source || "Inbound")}${owners(r.ownerId)}${select("Status", "status", ["New", "Contacted", "Qualified", "Disqualified"], r.status || "New")}</div>${notes(r.notes)}`;
  if (kind === "accounts")
    html =
      field("Company name", "name", r.name, "text", "required") +
      `<div class="form-grid">${field("Industry", "industry", r.industry)}${owners(r.ownerId)}</div>` +
      field("Website", "website", r.website) +
      notes(r.notes);
  if (kind === "contacts")
    html = `<div class="form-grid">${field("Full name", "name", r.name, "text", "required")}${field("Email", "email", r.email, "email")}${field("Job title", "title", r.title)}${select("Account", "accountId", state.data.accounts, r.accountId, "No account")}${owners(r.ownerId)}</div>`;
  if (kind === "tasks")
    html =
      field("What needs to happen?", "title", r.title, "text", "required") +
      `<div class="form-grid">${field("Due date", "dueDate", r.dueDate || state.today, "date", "required")}${owners(r.ownerId)}</div>` +
      select(
        "Related deal",
        "dealId",
        state.data.deals,
        r.dealId || selectedDeal,
        "General task",
      );
  showDialog(
    `${id ? "Edit" : "New"} ${kind === "contacts" ? "contact" : kind.slice(0, -1)}`,
    `<form id="record-form" data-kind="${kind}" data-id="${id || ""}" data-version="${r.version || ""}">${html}<div class="form-error" role="alert"></div><div class="form-actions">${button("Cancel", "close", "secondary")}<button type="submit" class="btn primary" ${canWrite() ? "" : "disabled"}>${id ? "Save changes" : "Create " + kind.slice(0, -1)}</button></div></form>`,
    { wide: kind === "deals" },
  );
}
function showDeal(id) {
  const d = state.data.deals.find((d) => d.id === id);
  if (!d) {
    toast("This deal is not available.", true);
    return;
  }
  selectedDeal = id;
  const contact = state.data.contacts.find((c) => c.id === d.contactId),
    r = risks(d),
    events = state.events.filter((e) => e.record_id === id),
    activities = state.data.activities.filter((a) => a.dealId === id);
  showDialog(
    "Deal overview",
    `<div class="deal-detail-head"><span class="company-avatar large c-1">${escape(initial(account(d.accountId)?.name || d.name))}</span><div><span class="eyebrow">${escape(account(d.accountId)?.name || "OPPORTUNITY")}</span><h2>${escape(d.name)}</h2></div></div><div class="detail-value"><strong>${money(d.amount)}</strong>${stagePill(d.stage)}${canWrite() ? button("Edit deal", "edit-deal", "secondary", `data-id="${id}"`) : ""}</div><div class="detail-grid"><div><small>OWNER</small><b>${avatar(d.ownerId, "small")}${escape(member(d.ownerId).name)}</b></div><div><small>EXPECTED CLOSE</small><b>${shortDate(d.closeDate)}</b></div><div><small>FORECAST CATEGORY</small><b>${escape(d.forecast)}</b></div><div><small>BUYING CONTACT</small><b>${escape(contact?.name || "Not linked")}</b></div></div>${r.length ? `<div class="risk-box"><h3>${icon("alert")} Needs a little attention</h3>${r.map((x) => `<span>${escape(x)}</span>`).join("")}</div>` : ""}<div class="next-action-box"><small>NEXT MOVE</small><h3>${escape(d.nextStep || "Give this deal a next step")}</h3><span>${d.nextDate ? shortDate(d.nextDate) : "No date scheduled"}</span>${canWrite() ? button(icon("plus") + " Add task", "deal-task", "text-link", `data-id="${id}"`) : ""}</div><div class="detail-section"><h3>Tasks</h3>${
      state.data.tasks
        .filter((t) => t.dealId === id)
        .map(taskRow)
        .join("") || '<p class="muted">No tasks linked yet.</p>'
    }</div><div class="detail-section"><h3>Activity & notes</h3>${canWrite() ? `<form id="activity-form" data-id="${id}"><label class="sr-only" for="activity-text">Activity note</label><textarea id="activity-text" name="text" placeholder="Capture the conversation or leave a note…" required rows="3"></textarea><div class="activity-actions"><select name="kind" aria-label="Activity type"><option>Internal note</option><option>Customer interaction</option></select><button class="btn primary" type="submit">Log activity</button></div><div class="form-error" role="alert"></div></form>` : ""}${d.notes ? `<p class="saved-note">${escape(d.notes)}</p>` : ""}<div class="timeline">${activities.map((a) => `<article><span class="timeline-dot"></span><div><b>${escape(member(a.ownerId).name)}</b><small>${escape(a.kind)} · ${shortDate(a.createdAt)}</small><p>${escape(a.text)}</p></div></article>`).join("")}${events
      .slice(0, 8)
      .map(
        (e) =>
          `<article><span class="timeline-dot gray"></span><div><b>${escape(e.action)}</b><small>${escape(e.actor)} · ${shortDate(e.created_at)}</small>${
            e.data.before && e.data.after
              ? `<p>${
                  ["stage", "amount", "closeDate", "nextStep", "forecast"]
                    .filter((k) => e.data.before[k] !== e.data.after[k])
                    .map(
                      (k) =>
                        `${escape(k)}: ${escape(e.data.before[k] || "—")} → ${escape(e.data.after[k] || "—")}`,
                    )
                    .join("<br>") || "Record details updated."
                }</p>`
              : ""
          }</div></article>`,
      )
      .join("")}</div></div>`,
    { drawer: true },
  );
}
function showAccount(id) {
  const a = account(id);
  showDialog(
    escape(a.name),
    `<p class="muted">${escape(a.industry || "Company profile")}</p>${canWrite() ? button("Edit account", "edit-account", "secondary", `data-id="${id}"`) : ""}<div class="detail-section"><h3>Buying contacts</h3>${
      state.data.contacts
        .filter((c) => c.accountId === id)
        .map(
          (c) =>
            `<button class="contact-row" data-action="edit-contact" data-id="${c.id}"><span class="company-avatar c-2">${escape(initial(c.name))}</span><span><b>${escape(c.name)}</b><small>${escape(c.title || "Contact")} · ${escape(c.email || "No email")}</small></span>${icon("chevron")}</button>`,
        )
        .join("") || '<p class="muted">No contacts linked yet.</p>'
    }</div><div class="detail-section"><h3>Opportunities</h3>${
      state.data.deals
        .filter((d) => d.accountId === id)
        .map(
          (d) =>
            `<button class="change-row" data-action="deal" data-id="${d.id}"><b>${escape(d.name)}</b><span>${money(d.amount)} · ${escape(d.stage)}</span></button>`,
        )
        .join("") || '<p class="muted">No deals linked yet.</p>'
    }</div>${a.notes ? `<p>${escape(a.notes)}</p>` : ""}`,
    { drawer: true },
  );
}
function convertLead(id) {
  const l = state.data.leads.find((l) => l.id === id);
  showDialog(
    "Turn interest into opportunity",
    `<p class="muted">Qualify ${escape(l.name)} at ${escape(l.company || "a new account")}. We’ll link the account and contact, preserve the lead, and create the first task.</p><form id="convert-form" data-id="${id}" data-version="${l.version}">${field("Deal name", "name", `${l.company || l.name} opportunity`, "text", "required")}<div class="form-grid">${field(`Deal value (${settings().currency})`, "amount", "", "number", 'required min="0" step="0.01"')}${field("Expected close", "closeDate", dateAfter(30), "date", "required")}</div>${field("Next step", "nextStep", "Schedule discovery", "text", "required")}${field("Next step date", "nextDate", state.today, "date", "required")}<div class="form-error" role="alert"></div><div class="form-actions">${button("Cancel", "close", "secondary")}<button type="submit" class="btn primary">Create opportunity ${icon("arrow")}</button></div></form>`,
  );
}
function accountMenu(mode = "register") {
  showDialog(
    state.workspace.demo ? "Your own space to grow" : "Account & session",
    `<div class="auth-tabs">${button("Create workspace", "auth-register", mode === "register" ? "selected" : "")}${button("Sign in", "auth-login", mode === "login" ? "selected" : "")}</div><p class="muted">${mode === "register" ? "Create a separate, empty workspace. Your current demo stays separate." : "Access a workspace previously created on this server."}</p><form id="auth-form" data-mode="${mode}">${mode === "register" ? field("Your name", "name", "", "text", 'required autocomplete="name"') : ""}${field("Email", "email", "", "email", 'required autocomplete="email"')}${field("Password", "password", "", "password", `required minlength="12" maxlength="256" autocomplete="${mode === "register" ? "new-password" : "current-password"}"`)}<p class="field-help">At least 12 characters. This local release does not provide password recovery.</p><div class="form-error" role="alert"></div><button type="submit" class="btn primary full-width">${mode === "register" ? "Create workspace" : "Sign in"}</button></form><div class="form-divider"></div>${button(icon("logout") + " Sign out", "logout", "secondary")}`,
  );
}
function csvParse(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((x) => x.trim())) rows.push(row);
  }
  if (rows.length < 2)
    throw new Error("Include a header and at least one record.");
  const headers = rows
    .shift()
    .map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, "").trim() : h.trim()));
  if (new Set(headers).size !== headers.length || headers.some((h) => !h))
    throw new Error("Column headings must be unique and nonempty.");
  return { headers, rows };
}
function importDialog() {
  importRows = null;
  importPreview = null;
  showDialog(
    "Bring your pipeline into focus",
    `<p class="muted">Import up to 5,000 records from a UTF-8 CSV. Review the mapping and validation before anything is saved.</p><label>Record type<select id="import-kind"><option value="leads" ${view === "leads" ? "selected" : ""}>Leads</option><option value="deals" ${view === "pipeline" ? "selected" : ""}>Deals</option></select></label><label class="file-zone">${icon("upload")}<b>Choose a CSV file</b><span>Dates: YYYY-MM-DD · Amounts: 1200 or 1,200.00</span><input type="file" id="import-file" accept=".csv,text/csv"></label><div id="mapping-area"></div><div class="form-error" id="import-error" role="alert"></div>`,
    { wide: true },
  );
}
function mappingUI() {
  const fields =
    importKind === "leads"
      ? ["name", "company", "email", "source", "status"]
      : [
          "name",
          "amount",
          "stage",
          "closeDate",
          "nextStep",
          "nextDate",
          "source",
          "forecast",
        ];
  const aliases = {
    name: ["name", "full name", "deal name", "lead name"],
    amount: ["amount", "value", "deal value"],
    closeDate: ["closedate", "close date", "expected close"],
    company: ["company", "organization"],
  };
  $("#mapping-area").innerHTML =
    `<h3>Match your columns</h3><p class="field-help">${importRows.rows.length} source rows. All new records are assigned to you. Deal imports use the workspace currency; account linking can be done after import.</p><form id="mapping-form"><div class="form-grid">${fields
      .map((f) => {
        const matching = importRows.headers.find((h) =>
          (aliases[f] || [f.toLowerCase()]).includes(h.toLowerCase()),
        );
        return select(
          f.replace(/([A-Z])/g, " $1"),
          "map-" + f,
          importRows.headers,
          matching,
          "Not mapped",
        );
      })
      .join(
        "",
      )}</div><div class="form-actions"><button type="submit" class="btn primary">Validate import ${icon("arrow")}</button></div></form><div id="import-results"></div>`;
}
function mappedRows(form) {
  const mappings = Object.fromEntries(new FormData(form));
  return importRows.rows.map((values) => {
    const row = { ownerId: state.user.id };
    for (const [key, header] of Object.entries(mappings))
      if (header)
        row[key.slice(4)] = values[importRows.headers.indexOf(header)] || "";
    if (importKind === "deals") {
      row.stage ||= settings().stages[0];
      row.forecast ||= "Pipeline";
    }
    return row;
  });
}
function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(v) {
  if (typeof v === "number") return String(v);
  let t = String(v ?? "");
  if (/^[\s]*[=+\-@]/.test(t)) t = "'" + t;
  return '"' + t.replaceAll('"', '""') + '"';
}
function exportDeals() {
  const rows = [
    [
      "Deal",
      "Company",
      "Amount",
      "Currency",
      "Stage",
      "Owner",
      "Expected close",
      "Next step",
    ],
    ...filtered(state.data.deals).map((d) => [
      d.name,
      account(d.accountId)?.name || "",
      d.amount,
      settings().currency,
      d.stage,
      member(d.ownerId).name,
      d.closeDate,
      d.nextStep,
    ]),
  ];
  download(
    "salesscope-deals.csv",
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
    "text/csv",
  );
  toast("Deal export downloaded.");
}
function navigate(next) {
  owner = "all";
  query = "";
  view = next;
  location.hash = next;
  render();
}
document.addEventListener("click", async (e) => {
  if (e.target.closest(".skip-link")) {
    e.preventDefault();
    $("#main")?.focus();
    return;
  }
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  try {
    if (action === "navigate") {
      navigate(target.dataset.view);
      return;
    }
    if (action === "attention") {
      stageFilter = "Needs attention";
      navigate("pipeline");
      return;
    }
    if (action === "apply-template") {
      const f = $("#pipeline-form"),
        v = f.elements.template.value;
      const presets = {
        Services: [
          "Discovery",
          "Qualified",
          "Proposal",
          "Negotiation",
          "Won",
          "Lost",
        ],
        "B2B software": [
          "Discovery",
          "Evaluation",
          "Procurement",
          "Won",
          "Lost",
        ],
        Manufacturing: [
          "Inquiry",
          "Technical review",
          "Quote",
          "Negotiation",
          "Won",
          "Lost",
        ],
        "Commercial services": [
          "Inquiry",
          "Site assessment",
          "Estimate",
          "Follow-up",
          "Won",
          "Lost",
        ],
      };
      f.elements.stages.value = presets[v].join("\n");
      toast("Template stages filled. Review and save to apply.");
      return;
    }
    if (action === "save-view") {
      showDialog(
        "Save this pipeline view",
        `<form id="view-form">${field("View name", "name", "", "text", "required")}<p class="field-help">Saves your owner, stage, search, and layout choices.</p><div class="form-error" role="alert"></div><button class="btn primary" type="submit">Save view</button></form>`,
      );
      return;
    }
    if (action === "close") {
      closeDialog();
      return;
    }
    if (action === "menu") {
      document.body.classList.toggle("nav-open");
      $(".sidebar").inert = !document.body.classList.contains("nav-open");
      target.setAttribute(
        "aria-expanded",
        document.body.classList.contains("nav-open"),
      );
      return;
    }
    if (action === "deal") {
      showDeal(id);
      return;
    }
    if (action === "account") {
      showAccount(id);
      return;
    }
    if (action === "new-deal") {
      editForm("deals", null, target.dataset.stage);
      return;
    }
    if (action === "edit-deal") {
      editForm("deals", id);
      return;
    }
    for (const kind of ["lead", "task", "account", "contact"])
      if (action === `new-${kind}` || action === `edit-${kind}`) {
        editForm(kind + "s", id);
        return;
      }
    if (action === "deal-task") {
      selectedDeal = id;
      editForm("tasks");
      return;
    }
    if (action === "convert") {
      convertLead(id);
      return;
    }
    if (action === "load-view") {
      const v = state.data.views.find((v) => v.id === id);
      owner = v.ownerFilter;
      stageFilter = v.stageFilter;
      query = v.query;
      boardMode = v.mode;
      render();
      return;
    }
    if (action === "reset-view") {
      owner = "all";
      query = "";
      stageFilter = "Open";
      render();
      return;
    }
    if (action === "stage-view") {
      stageFilter = target.dataset.stage;
      view = "pipeline";
      location.hash = "pipeline";
      render();
      return;
    }
    if (action === "board-mode") {
      boardMode = target.dataset.mode;
      render();
      return;
    }
    if (action === "task-toggle") {
      const task = state.data.tasks.find((t) => t.id === id),
        deal = selectedDeal;
      target.disabled = true;
      await api(`/records/tasks/${id}`, "PATCH", { ...task, done: !task.done });
      await refresh();
      if (deal) showDeal(deal);
      else if (overlay.innerHTML) allTasks();
      toast(
        task.done ? "Task reopened." : "One more step forward. Task completed.",
      );
      return;
    }
    if (action === "all-tasks") {
      allTasks();
      return;
    }
    if (
      action === "account-menu" ||
      action === "auth-register" ||
      action === "auth-login"
    ) {
      accountMenu(action === "auth-login" ? "login" : "register");
      return;
    }
    if (action === "invite") {
      showDialog(
        "Invite a teammate",
        `<p class="muted">Create a single-use invitation, valid for seven days. Share it yourself; no email is sent.</p><form id="invite-form">${field("Teammate email", "email", "", "email", "required")}${select(
          "Access role",
          "role",
          [
            { id: "rep", name: "Representative · own records" },
            { id: "manager", name: "Manager · all records and forecasts" },
            { id: "viewer", name: "Viewer · own records, read only" },
          ],
          "rep",
        )}<div class="form-error" role="alert"></div><button type="submit" class="btn primary">Create invitation</button></form>`,
      );
      return;
    }
    if (action === "logout") {
      await api("/auth/logout", "POST");
      closeDialog();
      showWelcome();
      return;
    }
    if (action === "demo") {
      target.disabled = true;
      await api("/demo", "POST");
      await refresh();
      return;
    }
    if (action === "import") {
      importDialog();
      return;
    }
    if (action === "import-commit") {
      target.disabled = true;
      const result = await api("/import", "POST", {
        kind: importKind,
        rows: importPreview.rows,
      });
      await refresh();
      $("#import-results").innerHTML =
        `<div class="import-result"><h3>${result.replayed ? "This file was already imported" : `${result.accepted} records imported`}</h3><p>${result.rejected} rejected · ${result.total} total rows. ${result.replayed ? "No duplicate records were added." : "Accepted records are now in your workspace."}</p>${button("Done", "close", "primary")}</div>`;
      toast("Import reconciled and saved.");
      return;
    }
    if (action === "import-errors") {
      download(
        "salesscope-import-errors.csv",
        [
          ["Row", "Reason"],
          ...importPreview.result.errors.map((e) => [e.row, e.reason]),
        ]
          .map((r) => r.map(csvCell).join(","))
          .join("\r\n"),
        "text/csv",
      );
      return;
    }
    if (action === "export-deals") {
      exportDeals();
      return;
    }
    if (action === "export-workspace") {
      download(
        "salesscope-workspace.json",
        JSON.stringify(await api("/export"), null, 2),
        "application/json",
      );
      toast("Workspace export downloaded.");
      return;
    }
    if (action === "template") {
      download(
        "salesscope-lead-template.csv",
        "name,company,email,source,status\r\nTaylor Smith,Example Co,taylor@example.com,Referral,New\r\n",
        "text/csv",
      );
      return;
    }
    if (action === "snapshot") {
      showDialog(
        "Save this moment in your pipeline",
        `<form id="snapshot-form">${field("Snapshot name", "name", `${periodLabel()} review · ${shortDate(state.today)}`, "text", "required")}${notes("")}<p class="field-help">Preserves the current forecast and deal state. Later edits will not change this snapshot.</p><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">Save snapshot</button></div></form>`,
      );
      return;
    }
    if (action === "snapshot-detail") {
      const s = state.data.snapshots.find((s) => s.id === id);
      showDialog(
        escape(s.name),
        `<p class="muted">Saved ${new Date(s.createdAt).toLocaleString()}</p><div class="mini-stats"><div><span>Booked</span><b>${money(s.metrics.booked)}</b></div><div><span>Commit</span><b>${money(s.metrics.commit)}</b></div><div><span>Best case</span><b>${money(s.metrics.bestCase)}</b></div></div><p>${escape(s.notes || "No review notes.")}</p><div class="table-scroll"><table><thead><tr><th>DEAL</th><th>STAGE</th><th>VALUE</th></tr></thead><tbody>${s.deals.map((d) => `<tr><td>${escape(d.name)}</td><td>${escape(d.stage)}</td><td>${money(d.amount)}</td></tr>`).join("")}</tbody></table></div>`,
        { wide: true },
      );
      return;
    }
    if (action === "search") {
      showDialog(
        "Find your next move",
        `<label class="input-search command-search">${icon("search")}<input id="global-search" placeholder="Search deals, leads, or companies…" autofocus aria-label="Search workspace"></label><div id="search-results"><p class="muted">Start typing to find a record in your workspace.</p></div>`,
      );
      return;
    }
  } catch (error) {
    toast(error.message, true);
    target.disabled = false;
  }
});
function allTasks() {
  showDialog(
    "Your action list",
    `<div class="dialog-actions">${canWrite() ? button(icon("plus") + " Add task", "new-task", "primary") : ""}</div>${
      [...state.data.tasks]
        .sort(
          (a, b) =>
            Number(a.done) - Number(b.done) ||
            a.dueDate.localeCompare(b.dueDate),
        )
        .map(taskRow)
        .join("") ||
      empty("Nothing on the list", "Create a task to get started.")
    }`,
    { wide: true },
  );
}
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.id) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)),
    submit = $('[type="submit"]', form);
  if (submit) submit.disabled = true;
  const errorNode = $(".form-error", form);
  if (errorNode) errorNode.textContent = "";
  try {
    if (form.id === "view-form") {
      await api("/records/views", "POST", {
        ...data,
        ownerId: state.user.id,
        ownerFilter: owner,
        stageFilter,
        query,
        mode: boardMode,
      });
      closeDialog();
      await refresh();
      toast("View saved.");
    }
    if (form.id === "record-form") {
      const { kind, id, version } = form.dataset;
      if (kind === "deals") data.amount = Number(data.amount);
      if (id) data.version = Number(version);
      const record = await api(
        `/records/${kind}${id ? "/" + id : ""}`,
        id ? "PATCH" : "POST",
        data,
      );
      closeDialog();
      await refresh();
      if (kind === "deals") showDeal(record.id);
      toast(
        `${kind === "deals" ? "Deal" : kind === "leads" ? "Lead" : "Record"} saved.`,
      );
    }
    if (form.id === "convert-form") {
      const result = await api("/convert", "POST", {
        ...data,
        id: form.dataset.id,
        version: Number(form.dataset.version),
        amount: Number(data.amount),
      });
      closeDialog();
      await refresh();
      showDeal(result.dealId);
      toast("Lead qualified. Your next opportunity is ready.");
    }
    if (form.id === "activity-form") {
      const id = form.dataset.id;
      await api("/records/activities", "POST", {
        ...data,
        dealId: id,
        ownerId: state.user.id,
      });
      await refresh();
      showDeal(id);
      toast("Activity logged.");
    }
    if (form.id === "settings-form") {
      await api("/settings", "PATCH", {
        ...data,
        target: Number(data.target),
        staleDays: Number(data.staleDays),
      });
      await refresh();
      toast("Workspace preferences saved.");
    }
    if (form.id === "pipeline-form") {
      const stages = data.stages
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        probabilities = Object.fromEntries(
          stages.map((s) => [
            s,
            data["prob-" + s] !== undefined
              ? Number(data["prob-" + s]) / 100
              : 0.2,
          ]),
        );
      await api("/settings", "PATCH", {
        stages,
        probabilities,
        template: data.template,
      });
      await refresh();
      toast("Pipeline configuration saved.");
    }
    if (form.id === "invite-form") {
      const invite = await api("/invitations", "POST", data);
      const link = `${location.origin}/?invite=${encodeURIComponent(invite.token)}`;
      showDialog(
        "Invitation ready",
        `<p class="muted">Share this single-use link with ${escape(invite.email)}. It expires in seven days and grants ${escape(invite.role)} access.</p>${field("Invitation link", "link", link, "text", "readonly")}<p class="field-help">The recipient must be able to reach this server. A localhost address only works on this computer. No email has been sent.</p>${button("Done", "close", "primary")}`,
      );
    }
    if (form.id === "join-form") {
      await api("/auth/join", "POST", {
        ...data,
        token: new URLSearchParams(location.search).get("invite"),
      });
      history.replaceState(null, "", "/");
      closeDialog();
      view = "today";
      await refresh();
      toast("You joined the workspace.");
    }
    if (form.id === "auth-form") {
      await api("/auth/" + form.dataset.mode, "POST", data);
      closeDialog();
      view = "today";
      location.hash = "today";
      await refresh();
      toast("Welcome to your workspace.");
    }
    if (form.id === "snapshot-form") {
      await api("/snapshots", "POST", data);
      closeDialog();
      await refresh();
      toast("Forecast snapshot saved.");
    }
    if (form.id === "mapping-form") {
      const rows = mappedRows(form);
      const result = await api("/import", "POST", {
        kind: importKind,
        rows,
        preview: true,
      });
      importPreview = { rows, result };
      $("#import-results").innerHTML =
        `<div class="import-result"><h3>${result.replayed ? "Already imported" : `${result.accepted} ready to import`}</h3><p>${result.total} rows · ${result.rejected} rejected. ${result.replayed ? "Submitting again will not create duplicates." : "Only accepted rows will be committed."}</p>${result.errors
          .slice(0, 8)
          .map(
            (x) =>
              `<p class="import-error">Row ${x.row}: ${escape(x.reason)}</p>`,
          )
          .join(
            "",
          )}<div class="form-actions">${result.errors.length ? button("Download all errors", "import-errors", "secondary") : ""}${result.accepted ? button(result.replayed ? "Confirm existing import" : "Import accepted records", "import-commit", "primary") : ""}</div></div>`;
    }
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message;
    else if ($("#import-error")) $("#import-error").textContent = error.message;
    else toast(error.message, true);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (e.target.id === "workspace-select") {
      await api("/workspace", "POST", { id: e.target.value });
      owner = "all";
      query = "";
      await refresh();
      toast("Workspace switched.");
    }
    if (e.target.id === "owner-filter") {
      owner = e.target.value;
      render();
    }
    if (e.target.id === "stage-filter") {
      stageFilter = e.target.value;
      render();
    }
    if (e.target.id === "import-kind" && importRows) {
      importKind = e.target.value;
      importPreview = null;
      mappingUI();
    }
    if (e.target.id === "import-file") {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 4e6) throw new Error("Keep CSV files under 4 MB.");
      importRows = csvParse(await file.text());
      if (importRows.rows.length > 5000)
        throw new Error("Import at most 5,000 records at a time.");
      importKind = $("#import-kind").value;
      mappingUI();
    }
  } catch (error) {
    $("#import-error").textContent = error.message;
  }
});
let filterTimer;
document.addEventListener("input", (e) => {
  if (e.target.id === "filter-query") {
    const value = e.target.value,
      position = e.target.selectionStart;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      query = value;
      render();
      $("#filter-query")?.focus();
      $("#filter-query")?.setSelectionRange(position, position);
    }, 160);
  }
  if (e.target.id === "global-search") {
    const q = e.target.value.toLowerCase().trim(),
      results = q
        ? ["deals", "leads", "accounts"]
            .flatMap((kind) =>
              state.data[kind]
                .filter((r) =>
                  `${r.name} ${r.company || ""}`.toLowerCase().includes(q),
                )
                .map((r) => ({ r, kind })),
            )
            .slice(0, 12)
        : [];
    $("#search-results").innerHTML =
      results
        .map(
          ({ r, kind }) =>
            `<button class="search-result" data-action="${kind === "deals" ? "deal" : kind === "accounts" ? "account" : "edit-lead"}" data-id="${r.id}">${icon(kind === "deals" ? "pipeline" : kind === "accounts" ? "building" : "users")}<span><b>${escape(r.name)}</b><small>${kind.slice(0, -1)}</small></span>${icon("arrow")}</button>`,
        )
        .join("") ||
      `<p class="muted">${q ? "No records match your search." : "Start typing to search."}</p>`;
  }
  if (e.target.closest("#mapping-form")) {
    $("#import-results").innerHTML = "";
    importPreview = null;
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $('[data-action="search"]')?.click();
  }
  if (e.key === "Escape") {
    closeDialog();
    document.body.classList.remove("nav-open");
    if (matchMedia("(max-width:720px)").matches && $(".sidebar"))
      $(".sidebar").inert = true;
  }
  if (e.key === "Tab" && overlay.innerHTML) {
    const focusable = [
      ...overlay.querySelectorAll(
        "button:not([disabled]),input,select,textarea,a[href]",
      ),
    ].filter((n) => n.offsetParent !== null);
    const first = focusable[0],
      last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
window.addEventListener("hashchange", () => {
  view = location.hash.slice(1) || "today";
  query = "";
  owner = "all";
  document.body.classList.remove("nav-open");
  closeDialog();
  if (state) render();
});
function showWelcome() {
  app.innerHTML = `<main class="welcome"><div class="welcome-brand brand"><span class="brand-mark">${icon("chart")}</span>SalesScope.</div><p class="eyebrow">YOUR NEXT CHAPTER</p><h1>A clearer view.<br>A stronger next move.</h1><p>Bring your leads, deals, and daily priorities into one focused workspace.</p><div class="welcome-actions">${button("Explore the demo " + icon("arrow"), "demo", "primary")}${button("Sign in", "auth-login", "secondary")}${button("Create workspace", "auth-register", "secondary")}</div><small>Local application · Demo data is synthetic · Nothing is sent to a CRM</small></main>`;
}
window.addEventListener("resize", () => {
  if ($(".sidebar"))
    $(".sidebar").inert =
      matchMedia("(max-width:720px)").matches &&
      !document.body.classList.contains("nav-open");
});
async function boot() {
  try {
    const inviteToken = new URLSearchParams(location.search).get("invite");
    if (inviteToken) {
      app.innerHTML =
        '<main class="welcome"><div class="welcome-brand brand">SalesScope.</div><h1>Your team is waiting.</h1><p>One shared picture. A clear next move.</p></main>';
      const invitation = await api(
        "/invitation?token=" + encodeURIComponent(inviteToken),
      );
      showDialog(
        `Join ${escape(invitation.name)}`,
        `<p class="muted">You’re invited as a ${escape(invitation.role)} using ${escape(invitation.email)}.</p><form id="join-form">${field("Your name", "name", "", "text", 'required autocomplete="name"')}${field("Password", "password", "", "password", 'required minlength="12" maxlength="256" autocomplete="new-password"')}<p class="field-help">Choose at least 12 characters. If you already have an account on this server, enter its existing password.</p><div class="form-error" role="alert"></div><button class="btn primary" type="submit">Join workspace</button></form>`,
      );
      return;
    }
    await refresh();
  } catch (error) {
    if (error.status === 401) {
      await api("/demo", "POST");
      await refresh();
    } else {
      app.innerHTML = `<main class="welcome"><h1>Couldn’t load the workspace.</h1><p>${escape(error.message)}</p><p>Make sure the SalesScope server is running, then reload.</p></main>`;
    }
  }
}
boot();
