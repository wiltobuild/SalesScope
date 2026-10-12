import { randomUUID } from "node:crypto";

export const collections = [
  "deals",
  "leads",
  "accounts",
  "contacts",
  "tasks",
  "activities",
  "snapshots",
  "views",
];
export const stages = [
  "Discovery",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
];
export const probabilities = {
  Discovery: 0.15,
  Qualified: 0.35,
  Proposal: 0.6,
  Negotiation: 0.8,
  Won: 1,
  Lost: 0,
};
export const dateOffset = (days, base = new Date()) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const today = (timeZone = "America/New_York") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const defaultSettings = {
  name: "Northstar Studio",
  currency: "USD",
  timezone: "America/New_York",
  target: 300000,
  staleDays: 14,
  template: "Services",
  stages,
  probabilities,
};
export const openDeal = (d) => !["Won", "Lost"].includes(d.stage);
export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function moneyValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text || !/^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))
    return null;
  const n = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
export function validateRecord(type, input, settings, ownerIds) {
  const data = {};
  const fields = {
    deals: [
      "name",
      "accountId",
      "contactId",
      "amount",
      "stage",
      "ownerId",
      "closeDate",
      "nextStep",
      "nextDate",
      "lastContact",
      "source",
      "forecast",
      "lossReason",
      "notes",
    ],
    leads: ["name", "company", "email", "source", "ownerId", "status", "notes"],
    accounts: ["name", "industry", "website", "notes", "ownerId"],
    contacts: ["name", "email", "title", "accountId", "ownerId"],
    tasks: ["title", "dealId", "ownerId", "dueDate", "done"],
    activities: ["dealId", "text", "kind", "ownerId"],
    views: ["name", "ownerId", "ownerFilter", "stageFilter", "query", "mode"],
  }[type];
  if (!fields) throw new Error("Unsupported record type.");
  for (const key of fields)
    if (input[key] !== undefined) {
      if (key === "amount") {
        data[key] = moneyValue(input[key]);
        if (data[key] === null || data[key] < 0 || data[key] > 1e12)
          throw new Error("Amount must be between 0 and 1 trillion.");
        if (Math.abs(data[key] * 100 - Math.round(data[key] * 100)) > 0.001)
          throw new Error("Amounts may have at most two decimal places.");
        data[key] = Math.round(data[key] * 100) / 100;
      } else if (key === "done") data[key] = input[key] === true;
      else {
        if (typeof input[key] !== "string")
          throw new Error(`${key} must be text.`);
        data[key] = input[key]
          .trim()
          .slice(0, key === "notes" || key === "text" ? 10000 : 300);
      }
    }
  const title = data.name ?? data.title ?? data.text;
  if (!title) throw new Error("A name or description is required.");
  if (!ownerIds.includes(data.ownerId))
    throw new Error("Choose a valid workspace owner.");
  for (const key of ["closeDate", "nextDate", "lastContact", "dueDate"])
    if (data[key] && !validDate(data[key]))
      throw new Error(`${key} must be a real date in YYYY-MM-DD format.`);
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    throw new Error("Enter a valid email address.");
  if (type === "deals") {
    if (!settings.stages.includes(data.stage))
      throw new Error("Choose a valid pipeline stage.");
    if (data.amount === undefined) throw new Error("Amount is required.");
    if (!data.closeDate) throw new Error("Expected close date is required.");
    if (!["Pipeline", "Best case", "Commit", "Omitted"].includes(data.forecast))
      data.forecast = "Pipeline";
    if (data.stage === "Lost" && !data.lossReason)
      throw new Error("Record a reason before marking a deal lost.");
  }
  if (
    type === "leads" &&
    !["New", "Contacted", "Qualified", "Disqualified"].includes(data.status)
  )
    data.status = "New";
  if (type === "tasks" && !data.dueDate)
    throw new Error("A task due date is required.");
  return data;
}
export function riskReasons(deal, tasks, settings, date = today()) {
  if (!openDeal(deal)) return [];
  const reasons = [];
  if (!deal.nextStep) reasons.push("No next step");
  else if (deal.nextDate && deal.nextDate < date)
    reasons.push("Next step overdue");
  if (deal.closeDate < date) reasons.push("Close date passed");
  if (
    !deal.lastContact ||
    deal.lastContact < dateOffset(-settings.staleDays, date)
  )
    reasons.push("No recent customer contact");
  if (tasks.some((t) => t.dealId === deal.id && !t.done && t.dueDate < date))
    reasons.push("Overdue task");
  return reasons;
}
export function metrics(deals, settings, date = today()) {
  const quarterStart = new Date(`${date}T12:00:00Z`);
  quarterStart.setUTCMonth(Math.floor(quarterStart.getUTCMonth() / 3) * 3, 1);
  const start = quarterStart.toISOString().slice(0, 10);
  const endDate = new Date(quarterStart);
  endDate.setUTCMonth(endDate.getUTCMonth() + 3);
  const end = endDate.toISOString().slice(0, 10);
  const inPeriod = (d) => d >= start && d < end;
  const open = deals.filter(openDeal);
  const relevant = open.filter((d) => inPeriod(d.closeDate));
  const won = deals.filter(
    (d) => d.stage === "Won" && inPeriod(d.closedAt?.slice(0, 10) || ""),
  );
  const lost = deals.filter(
    (d) => d.stage === "Lost" && inPeriod(d.closedAt?.slice(0, 10) || ""),
  );
  const sum = (rows) =>
    Math.round(rows.reduce((n, d) => n + d.amount, 0) * 100) / 100;
  const booked = sum(won);
  return {
    start,
    end,
    open: sum(open),
    openCount: open.length,
    quarterPipeline: sum(relevant),
    booked,
    wonCount: won.length,
    winRate:
      won.length + lost.length
        ? (won.length / (won.length + lost.length)) * 100
        : null,
    weighted: Math.round(
      relevant
        .filter((d) => d.forecast !== "Omitted")
        .reduce(
          (n, d) => n + d.amount * (settings.probabilities[d.stage] ?? 0),
          0,
        ),
    ),
    commit: booked + sum(relevant.filter((d) => d.forecast === "Commit")),
    bestCase:
      booked +
      sum(relevant.filter((d) => ["Commit", "Best case"].includes(d.forecast))),
    gap: Math.max(settings.target - booked, 0),
    coverage:
      settings.target > booked
        ? sum(relevant) / (settings.target - booked)
        : null,
  };
}
export function seedWorkspace(ownerId, otherOwners = []) {
  const owners = [ownerId, ...otherOwners];
  const accountNames = [
    "Acme Corporation",
    "Linear Labs",
    "Orbit Digital",
    "Vercel Systems",
    "Notion Works",
    "Figma Studio",
    "Loom Creative",
    "Arc Technologies",
  ];
  const accounts = accountNames.map((name, i) => ({
    id: randomUUID(),
    name,
    industry: ["Technology", "Professional services", "Manufacturing"][i % 3],
    website: "",
    ownerId: owners[i % owners.length],
    notes: "",
  }));
  const people = [
    "Emma Wilson",
    "James Miller",
    "Olivia Chen",
    "Noah Williams",
    "Sophia Garcia",
    "Liam Taylor",
    "Ava Robinson",
    "Ethan Davis",
  ];
  const contacts = people.map((name, i) => ({
    id: randomUUID(),
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    title: ["VP of Operations", "Head of Growth", "Sales Director"][i % 3],
    accountId: accounts[i].id,
    ownerId: accounts[i].ownerId,
  }));
  const dealInfo = [
    [
      "Enterprise brand partnership",
      0,
      64000,
      "Negotiation",
      8,
      "Send revised proposal",
      -1,
      -5,
      "Commit",
    ],
    [
      "Growth strategy retainer",
      1,
      42000,
      "Proposal",
      17,
      "Present scope to leadership",
      1,
      -3,
      "Best case",
    ],
    [
      "Website & platform redesign",
      2,
      38500,
      "Qualified",
      28,
      "Run technical discovery",
      0,
      -2,
      "Pipeline",
    ],
    [
      "Annual consulting agreement",
      3,
      56000,
      "Negotiation",
      12,
      "Confirm procurement timeline",
      -2,
      -18,
      "Commit",
    ],
    [
      "Customer experience program",
      4,
      28500,
      "Discovery",
      38,
      "",
      0,
      -16,
      "Pipeline",
    ],
    [
      "Design systems engagement",
      5,
      32000,
      "Proposal",
      20,
      "Review pricing with Emma",
      2,
      -4,
      "Best case",
    ],
    [
      "Market expansion strategy",
      6,
      24000,
      "Qualified",
      30,
      "Schedule stakeholder interviews",
      3,
      -6,
      "Pipeline",
    ],
    [
      "Revenue operations audit",
      7,
      18000,
      "Discovery",
      40,
      "Share discovery agenda",
      4,
      -1,
      "Pipeline",
    ],
    ["Product launch campaign", 0, 48000, "Won", -4, "", 0, -4, "Commit"],
    ["Sales enablement program", 2, 36000, "Won", -10, "", 0, -10, "Commit"],
    ["Research sprint", 5, 18000, "Won", -14, "", 0, -14, "Commit"],
    ["Regional rollout", 6, 26000, "Lost", -8, "", 0, -8, "Omitted"],
  ];
  const deals = dealInfo.map(
    ([name, a, amount, stage, close, nextStep, due, last, forecast], i) => ({
      id: randomUUID(),
      name,
      accountId: accounts[a].id,
      contactId: contacts[a].id,
      amount,
      stage,
      ownerId: owners[i % owners.length],
      closeDate: dateOffset(close),
      nextStep,
      nextDate: nextStep ? dateOffset(due) : "",
      lastContact: dateOffset(last),
      forecast,
      source: ["Referral", "Inbound", "Outbound"][i % 3],
      notes: "",
      lossReason: stage === "Lost" ? "Budget postponed" : "",
      closedAt: ["Won", "Lost"].includes(stage)
        ? new Date(`${dateOffset(close)}T15:00:00Z`).toISOString()
        : null,
    }),
  );
  const tasks = deals
    .filter((d) => d.nextStep)
    .slice(0, 6)
    .map((d) => ({
      id: randomUUID(),
      title: d.nextStep,
      dealId: d.id,
      ownerId: d.ownerId,
      dueDate: d.nextDate,
      done: false,
    }));
  const leads = [
    ["Charlotte Lee", "Brightside", "Referral"],
    ["Benjamin Scott", "Evergreen Co.", "Website"],
    ["Amelia Martin", "Forma", "Event"],
    ["Lucas Thompson", "Atlas Ventures", "Outbound"],
    ["Isabella Clark", "Novo Health", "Website"],
  ].map(([name, company, source], i) => ({
    id: randomUUID(),
    name,
    company,
    email: `lead${i + 1}@example.com`,
    source,
    ownerId: owners[i % owners.length],
    status: i === 2 ? "Contacted" : "New",
    notes: "",
  }));
  const activities = deals
    .slice(0, 5)
    .map((d, i) => ({
      id: randomUUID(),
      dealId: d.id,
      ownerId: d.ownerId,
      text: [
        "Discovery call completed. Team aligned on priorities.",
        "Proposal shared with the buying team.",
        "Budget and timeline discussed.",
      ][i % 3],
      kind: "Customer interaction",
      createdAt: new Date(`${dateOffset(-i - 1)}T14:00:00Z`).toISOString(),
    }));
  return {
    accounts,
    contacts,
    deals,
    tasks,
    leads,
    activities,
    snapshots: [],
    views: [],
  };
}
