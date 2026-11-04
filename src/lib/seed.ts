/*
 * Demo seed for the Spectrum Group CRM & Agile platform.
 * Every organisation, person and figure below is fictional demo data.
 * Pure TypeScript (type-only imports) so scripts/generate-seed-sql.ts can compile it standalone.
 */
import type {
  Activity,
  ActivityType,
  Company,
  Contact,
  CrossLink,
  Deal,
  EmailTemplate,
  Epic,
  Issue,
  IssueComment,
  IssuePriority,
  IssueStatus,
  IssueType,
  LineItem,
  Pipeline,
  Product,
  Project,
  Quote,
  Sequence,
  SequenceEnrollment,
  Sprint,
  Ticket,
  User,
  Workflow,
} from "./types";

/* ───────────────────────── time helpers ───────────────────────── */

/** Anchor: Wed 4 Nov 2026, 09:00 WIB (UTC+7). */
export const SEED_NOW = Date.UTC(2026, 10, 4, 2, 0, 0);
const DAY = 86_400_000;
const at = (days: number, hour = 9, minute = 0) =>
  new Date(SEED_NOW + days * DAY + (hour - 9) * 3_600_000 + minute * 60_000).toISOString();

/* deterministic PRNG (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261104);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));

/* ───────────────────────── users ───────────────────────── */

export const CURRENT_USER_ID = "u-ben";

export const users: User[] = [
  { id: "u-ben", name: "Bennaya Kusuma", initials: "BK", email: "bennaya@kusuma.group", title: "Managing Director", team: "Leadership", color: "magenta" },
  { id: "u-rani", name: "Rani Wijaya", initials: "RW", email: "rani.wijaya@spectrumgroup.id", title: "Head of Sales", team: "Sales", color: "blue" },
  { id: "u-arif", name: "Arif Nugroho", initials: "AN", email: "arif.nugroho@spectrumgroup.id", title: "Account Executive — Energy & Industry", team: "Sales", color: "cyan" },
  { id: "u-sinta", name: "Sinta Maharani", initials: "SM", email: "sinta.maharani@spectrumgroup.id", title: "Account Executive — Maritime & Aerospace", team: "Sales", color: "green" },
  { id: "u-yoga", name: "Yoga Pratama", initials: "YP", email: "yoga.pratama@spectrumgroup.id", title: "Customer Success Manager", team: "Service", color: "yellow" },
  { id: "u-putri", name: "Putri Halim", initials: "PH", email: "putri.halim@spectrumgroup.id", title: "Field Support Lead", team: "Service", color: "orange" },
  { id: "u-fajar", name: "Fajar Santoso", initials: "FS", email: "fajar.santoso@spectrumgroup.id", title: "Engineering Manager", team: "Engineering", color: "red" },
  { id: "u-dimas", name: "Dimas Saputra", initials: "DS", email: "dimas.saputra@spectrumgroup.id", title: "Embedded & Control Engineer", team: "Engineering", color: "blue" },
  { id: "u-nadia", name: "Nadia Rahman", initials: "NR", email: "nadia.rahman@spectrumgroup.id", title: "Full-Stack Engineer", team: "Engineering", color: "cyan" },
  { id: "u-kevin", name: "Kevin Tanoto", initials: "KT", email: "kevin.tanoto@spectrumgroup.id", title: "AI / ML Engineer", team: "Engineering", color: "magenta" },
  { id: "u-ayu", name: "Ayu Kartika", initials: "AK", email: "ayu.kartika@spectrumgroup.id", title: "UAV Systems Engineer", team: "Engineering", color: "green" },
  { id: "u-bima", name: "Bima Siregar", initials: "BS", email: "bima.siregar@spectrumgroup.id", title: "QA & Certification Engineer", team: "Engineering", color: "orange" },
];

/* ───────────────────────── companies ───────────────────────── */

const M = 1_000_000;
const B = 1_000_000_000;

export const companies: Company[] = [
  { id: "c-nhs", name: "Nusantara Hydrographic Survey", domain: "nusantarahydro.co.id", industry: "Maritime Survey", city: "Jakarta", country: "Indonesia", employees: 420, annualRevenue: 610 * B, phone: "+62 21 5790 1120", description: "Bathymetric and seabed survey contractor serving ports, pipelines and offshore wind studies across the archipelago.", tier: "Strategic", parentId: null, ownerId: "u-sinta", lifecycleStage: "customer", createdAt: at(-410), enriched: true, linkedin: "nusantara-hydrographic", techStack: ["QPS Qinsy", "ArcGIS", "AWS"] },
  { id: "c-aam", name: "Archipelago Aerial Mapping", domain: "archimap.co.id", industry: "Geospatial Services", city: "Bandung", country: "Indonesia", employees: 140, annualRevenue: 128 * B, phone: "+62 22 8732 4410", description: "Photogrammetry and LiDAR mapping for mining concessions, forestry and infrastructure corridors.", tier: "Enterprise", parentId: null, ownerId: "u-sinta", lifecycleStage: "opportunity", createdAt: at(-205), enriched: true, linkedin: "archipelago-aerial-mapping", techStack: ["Pix4D", "Agisoft Metashape", "Azure"] },
  { id: "c-sbs", name: "Sinar Baja Steelworks", domain: "sinarbaja.co.id", industry: "Steel Manufacturing", city: "Cilegon", country: "Indonesia", employees: 3200, annualRevenue: 4_800 * B, phone: "+62 254 391 200", description: "Integrated steel producer operating two blast furnaces and a hot strip mill.", tier: "Strategic", parentId: null, ownerId: "u-arif", lifecycleStage: "customer", createdAt: at(-530), enriched: true, linkedin: "sinar-baja-steelworks", techStack: ["Siemens S7", "OSIsoft PI", "SAP S/4HANA"] },
  { id: "c-bap", name: "Borneo Agri Plantations", domain: "borneoagri.co.id", industry: "Agriculture", city: "Balikpapan", country: "Indonesia", employees: 5600, annualRevenue: 2_350 * B, phone: "+62 542 870 300", description: "Palm and rubber plantation group with 11 estates across East and Central Kalimantan.", tier: "Enterprise", parentId: null, ownerId: "u-arif", lifecycleStage: "sql", createdAt: at(-160), enriched: true, linkedin: "borneo-agri", techStack: ["SAP", "Google Workspace"] },
  { id: "c-bap-smp", name: "Borneo Agri — Sampit Estate", domain: "sampit.borneoagri.co.id", industry: "Agriculture", city: "Sampit", country: "Indonesia", employees: 780, annualRevenue: 310 * B, phone: "+62 531 21 880", description: "Largest estate in the group; pilot site for drone-based crop health monitoring.", tier: "Mid-Market", parentId: "c-bap", ownerId: "u-arif", lifecycleStage: "opportunity", createdAt: at(-120), enriched: false },
  { id: "c-spl", name: "Selat Port Logistics", domain: "selatport.co.id", industry: "Ports & Logistics", city: "Surabaya", country: "Indonesia", employees: 1900, annualRevenue: 1_420 * B, phone: "+62 31 329 4400", description: "Container terminal operator running three terminals on Java's north coast.", tier: "Strategic", parentId: null, ownerId: "u-rani", lifecycleStage: "customer", createdAt: at(-380), enriched: true, linkedin: "selat-port-logistics", techStack: ["Navis N4", "Rockwell PLCs", "Microsoft 365"] },
  { id: "c-spl-tpk", name: "Selat Port — Priok Terminal", domain: "priok.selatport.co.id", industry: "Ports & Logistics", city: "Jakarta", country: "Indonesia", employees: 620, annualRevenue: 470 * B, phone: "+62 21 4390 7700", description: "Jakarta container terminal; first site for the crane telemetry rollout.", tier: "Enterprise", parentId: "c-spl", ownerId: "u-rani", lifecycleStage: "customer", createdAt: at(-300), enriched: true },
  { id: "c-mge", name: "Merapi Geothermal Energy", domain: "merapigeo.co.id", industry: "Renewable Energy", city: "Yogyakarta", country: "Indonesia", employees: 860, annualRevenue: 1_150 * B, phone: "+62 274 556 120", description: "Developer and operator of two geothermal power stations in Central Java.", tier: "Enterprise", parentId: null, ownerId: "u-arif", lifecycleStage: "opportunity", createdAt: at(-140), enriched: true, linkedin: "merapi-geothermal", techStack: ["Emerson DeltaV", "AVEVA"] },
  { id: "c-apg", name: "Andalas Power Grid", domain: "andalasgrid.co.id", industry: "Utilities", city: "Medan", country: "Indonesia", employees: 2400, annualRevenue: 3_100 * B, phone: "+62 61 451 9900", description: "Regional transmission operator for North Sumatra's 150 kV network.", tier: "Strategic", parentId: null, ownerId: "u-rani", lifecycleStage: "sql", createdAt: at(-95), enriched: true, techStack: ["ABB MicroSCADA", "Oracle"] },
  { id: "c-cam", name: "Cakrawala Aerospace MRO", domain: "cakrawala-mro.co.id", industry: "Aerospace MRO", city: "Tangerang", country: "Indonesia", employees: 1100, annualRevenue: 890 * B, phone: "+62 21 5591 8800", description: "Line and base maintenance for narrow-body fleets; expanding into UAS maintenance.", tier: "Enterprise", parentId: null, ownerId: "u-sinta", lifecycleStage: "customer", createdAt: at(-460), enriched: true, linkedin: "cakrawala-aerospace", techStack: ["AMOS", "SAP"] },
  { id: "c-bos", name: "Bahari Offshore Services", domain: "baharioffshore.co.id", industry: "Offshore Energy", city: "Batam", country: "Indonesia", employees: 530, annualRevenue: 720 * B, phone: "+62 778 469 300", description: "Subsea inspection, repair and maintenance for oil & gas operators in the Natuna Sea.", tier: "Enterprise", parentId: null, ownerId: "u-sinta", lifecycleStage: "opportunity", createdAt: at(-88), enriched: true },
  { id: "c-mcd", name: "Metro Cerdas Development", domain: "metrocerdas.co.id", industry: "Smart City", city: "Bekasi", country: "Indonesia", employees: 210, annualRevenue: 160 * B, phone: "+62 21 8896 3300", description: "Township developer deploying connected infrastructure across a 1,200 ha new-town project.", tier: "Mid-Market", parentId: null, ownerId: "u-rani", lifecycleStage: "lead", createdAt: at(-34), enriched: false },
  { id: "c-rct", name: "Rimba Conservation Trust", domain: "rimbatrust.org", industry: "Non-profit", city: "Pekanbaru", country: "Indonesia", employees: 65, annualRevenue: 21 * B, phone: "+62 761 330 210", description: "Conservation NGO running anti-poaching and peatland-fire monitoring programmes in Riau.", tier: "Emerging", parentId: null, ownerId: "u-sinta", lifecycleStage: "mql", createdAt: at(-41), enriched: false },
  { id: "c-twu", name: "Tirta Water Utilities", domain: "tirtawater.co.id", industry: "Water & Wastewater", city: "Semarang", country: "Indonesia", employees: 1300, annualRevenue: 640 * B, phone: "+62 24 765 1100", description: "Municipal water concession serving 1.4 M residents; non-revenue water reduction programme underway.", tier: "Enterprise", parentId: null, ownerId: "u-arif", lifecycleStage: "opportunity", createdAt: at(-77), enriched: true, techStack: ["Schneider ClearSCADA", "Esri"] },
  { id: "c-ptt", name: "Pelita Telecom Towers", domain: "pelitatowers.co.id", industry: "Telecommunications", city: "Jakarta", country: "Indonesia", employees: 950, annualRevenue: 1_870 * B, phone: "+62 21 2992 5500", description: "Independent tower company with 9,400 sites; evaluating drone-based structural inspection.", tier: "Strategic", parentId: null, ownerId: "u-sinta", lifecycleStage: "sql", createdAt: at(-58), enriched: true, linkedin: "pelita-towers" },
];

/* ───────────────────────── contacts ───────────────────────── */

type C = [id: string, first: string, last: string, title: string, company: string | null, owner: string, stage: Contact["lifecycleStage"], status: Contact["leadStatus"], score: number, lastDays: number | null, source: Contact["source"]];

const contactRows: C[] = [
  ["k-rina", "Rina", "Susanto", "Director of Survey Operations", "c-nhs", "u-sinta", "customer", "connected", 92, -2, "Referral"],
  ["k-hendra", "Hendra", "Gunawan", "Chief Technology Officer", "c-nhs", "u-sinta", "customer", "connected", 88, -6, "Event"],
  ["k-maya", "Maya", "Puspita", "Procurement Manager", "c-nhs", "u-yoga", "customer", "connected", 71, -12, "Referral"],
  ["k-agus", "Agus", "Setiawan", "Head of UAV Operations", "c-aam", "u-sinta", "opportunity", "in_progress", 84, -1, "Website"],
  ["k-lina", "Lina", "Marpaung", "Finance Director", "c-aam", "u-sinta", "opportunity", "open", 63, -15, "Website"],
  ["k-budi", "Budi", "Hartono", "VP Plant Engineering", "c-sbs", "u-arif", "customer", "connected", 90, -3, "Outbound"],
  ["k-sari", "Sari", "Widodo", "Automation & Reliability Lead", "c-sbs", "u-arif", "customer", "connected", 82, -5, "Outbound"],
  ["k-teguh", "Teguh", "Prakoso", "OT Security Manager", "c-sbs", "u-arif", "evangelist", "connected", 77, -21, "Event"],
  ["k-wulan", "Wulan", "Sari", "Head of Agronomy Innovation", "c-bap", "u-arif", "sql", "in_progress", 79, -4, "LinkedIn"],
  ["k-yusuf", "Yusuf", "Hamdani", "Estate Manager", "c-bap-smp", "u-arif", "opportunity", "connected", 74, -8, "Referral"],
  ["k-irwan", "Irwan", "Tambunan", "Group CIO", "c-bap", "u-rani", "sql", "open", 68, -26, "Outbound"],
  ["k-dian", "Dian", "Permata", "Chief Operating Officer", "c-spl", "u-rani", "customer", "connected", 86, -9, "Partner"],
  ["k-rizky", "Rizky", "Ananda", "Terminal Engineering Manager", "c-spl-tpk", "u-rani", "customer", "connected", 81, -1, "Partner"],
  ["k-fitri", "Fitri", "Handayani", "IT/OT Integration Lead", "c-spl-tpk", "u-yoga", "customer", "connected", 73, -4, "Partner"],
  ["k-eko", "Eko", "Wahyudi", "Plant Manager — Unit 2", "c-mge", "u-arif", "opportunity", "in_progress", 76, -3, "Event"],
  ["k-laras", "Laras", "Ayuningtyas", "Head of Reservoir Monitoring", "c-mge", "u-arif", "opportunity", "connected", 70, -10, "Event"],
  ["k-joko", "Joko", "Siswanto", "SCADA Modernisation Lead", "c-apg", "u-rani", "sql", "in_progress", 83, -2, "Outbound"],
  ["k-ratna", "Ratna", "Sembiring", "VP Grid Operations", "c-apg", "u-rani", "sql", "open", 66, -18, "Outbound"],
  ["k-andre", "Andre", "Wibisono", "Director of Engineering", "c-cam", "u-sinta", "customer", "connected", 87, -7, "Event"],
  ["k-mega", "Mega", "Lestiani", "Quality & Compliance Manager", "c-cam", "u-yoga", "customer", "connected", 72, -14, "Event"],
  ["k-hadi", "Hadi", "Kurniawan", "Subsea Operations Manager", "c-bos", "u-sinta", "opportunity", "in_progress", 78, -5, "LinkedIn"],
  ["k-novi", "Novi", "Rahmawati", "Commercial Manager", "c-bos", "u-sinta", "opportunity", "open", 61, -11, "LinkedIn"],
  ["k-gilang", "Gilang", "Ramadhan", "Smart Infrastructure Lead", "c-mcd", "u-rani", "lead", "new", 48, null, "Website"],
  ["k-tasya", "Tasya", "Amelia", "Digital Programme Officer", "c-mcd", "u-rani", "lead", "open", 41, -29, "Website"],
  ["k-yanti", "Yanti", "Situmorang", "Programme Director", "c-rct", "u-sinta", "mql", "open", 57, -16, "Website"],
  ["k-bayu", "Bayu", "Aditya", "Field Technology Coordinator", "c-rct", "u-sinta", "mql", "new", 52, null, "Event"],
  ["k-indah", "Indah", "Purnama", "NRW Programme Manager", "c-twu", "u-arif", "opportunity", "in_progress", 75, -2, "Referral"],
  ["k-rudy", "Rudy", "Halim", "Head of Network Operations", "c-twu", "u-arif", "opportunity", "connected", 69, -13, "Referral"],
  ["k-citra", "Citra", "Dewanti", "VP Asset Management", "c-ptt", "u-sinta", "sql", "in_progress", 80, -3, "Outbound"],
  ["k-ferry", "Ferry", "Kusnadi", "Tower Maintenance Manager", "c-ptt", "u-sinta", "sql", "connected", 64, -19, "Outbound"],
  ["k-ahmad", "Ahmad", "Fauzi", "Research Fellow", null, "u-rani", "subscriber", "new", 22, null, "Website"],
  ["k-sekar", "Sekar", "Ayu", "Graduate Engineer", null, "u-rani", "subscriber", "unqualified", 15, null, "Website"],
];

const emailFor = (first: string, last: string, companyId: string | null) => {
  const company = companies.find((c) => c.id === companyId);
  const domain = company ? company.domain.replace(/^[a-z]+\./, (m) => (company.parentId ? "" : m)) : "example.com";
  return `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@" + domain;
};

export const contacts: Contact[] = contactRows.map(([id, firstName, lastName, jobTitle, companyId, ownerId, lifecycleStage, leadStatus, leadScore, lastDays, source], i) => {
  const company = companies.find((c) => c.id === companyId) ?? null;
  return {
    id,
    firstName,
    lastName,
    jobTitle,
    companyId: company ? company.id : null,
    ownerId,
    lifecycleStage,
    leadStatus,
    leadScore,
    email: emailFor(firstName, lastName, company ? company.id : null),
    phone: `+62 8${11 + (i % 8)}-${String(1000 + ((i * 7919) % 9000)).padStart(4, "0")}-${String(2000 + ((i * 104729) % 7000)).padStart(4, "0")}`,
    city: company?.city ?? "Jakarta",
    lastContactedAt: lastDays === null ? null : at(lastDays, 10 + (i % 6), (i * 13) % 60),
    createdAt: at(-30 - ((i * 37) % 400)),
    source,
  };
});

/* ───────────────────────── pipelines ───────────────────────── */

export const pipelines: Pipeline[] = [
  {
    id: "pl-new",
    name: "New Business",
    objectType: "deal",
    stages: [
      { id: "st-discovery", name: "Discovery", probability: 0.1, color: "magenta" },
      { id: "st-qualified", name: "Qualified", probability: 0.2, color: "blue" },
      { id: "st-solution", name: "Solution Design", probability: 0.4, color: "cyan" },
      { id: "st-proposal", name: "Proposal Sent", probability: 0.6, color: "green" },
      { id: "st-negotiation", name: "Negotiation", probability: 0.8, color: "yellow" },
      { id: "st-won", name: "Closed Won", probability: 1, color: "orange", closed: "won" },
      { id: "st-lost", name: "Closed Lost", probability: 0, color: "red", closed: "lost" },
    ],
  },
  {
    id: "pl-renew",
    name: "Programme Renewals",
    objectType: "deal",
    stages: [
      { id: "st-r-review", name: "Account Review", probability: 0.3, color: "blue" },
      { id: "st-r-proposal", name: "Renewal Proposal", probability: 0.6, color: "cyan" },
      { id: "st-r-contract", name: "Contracting", probability: 0.85, color: "green" },
      { id: "st-r-won", name: "Renewed", probability: 1, color: "orange", closed: "won" },
      { id: "st-r-lost", name: "Churned", probability: 0, color: "red", closed: "lost" },
    ],
  },
  {
    id: "pl-support",
    name: "Field Support",
    objectType: "ticket",
    stages: [
      { id: "ts-new", name: "New", probability: 0, color: "magenta" },
      { id: "ts-waiting", name: "Waiting on Customer", probability: 0, color: "yellow" },
      { id: "ts-progress", name: "In Progress", probability: 0, color: "cyan" },
      { id: "ts-escalated", name: "Escalated to Engineering", probability: 0, color: "orange" },
      { id: "ts-resolved", name: "Resolved", probability: 0, color: "green", closed: "won" },
    ],
  },
];

/* ───────────────────────── deals ───────────────────────── */

type D = [id: string, name: string, amount: number, pipeline: string, stage: string, closeDays: number, owner: string, company: string, contacts: string[], priority: Deal["priority"], type: Deal["dealType"], cap: Deal["capability"], stageDays: number, desc: string];

const dealRows: D[] = [
  ["d-nhs-asv", "NHS — Autonomous Survey Vessel Retrofit", 8_400 * M, "pl-new", "st-negotiation", 18, "u-sinta", "c-nhs", ["k-rina", "k-hendra", "k-maya"], "high", "Expansion", "Unmanned Systems", -6, "Retrofit two 9 m survey launches with autonomy kit, obstacle detection and remote ops link."],
  ["d-nhs-ai", "NHS — Seabed Classification AI", 2_150 * M, "pl-new", "st-proposal", 32, "u-sinta", "c-nhs", ["k-hendra"], "medium", "Expansion", "Artificial Intelligence", -9, "Model to classify MBES backscatter into seabed classes; replaces manual interpretation."],
  ["d-aam-vtol", "AAM — VTOL Mapping Fleet (6 units)", 5_700 * M, "pl-new", "st-solution", 45, "u-sinta", "c-aam", ["k-agus", "k-lina"], "high", "New Business", "Unmanned Systems", -11, "Six long-endurance VTOL airframes with LiDAR payload integration and GCS."],
  ["d-aam-train", "AAM — Pilot & Maintenance Training", 640 * M, "pl-new", "st-qualified", 60, "u-sinta", "c-aam", ["k-agus"], "low", "New Business", "Engineering Management", -4, "Operator certification and level-2 maintenance training for 14 staff."],
  ["d-sbs-pdm", "SBS — Blast Furnace Predictive Maintenance", 6_900 * M, "pl-new", "st-won", -12, "u-arif", "c-sbs", ["k-budi", "k-sari"], "high", "Expansion", "Industrial IoT", -12, "Vibration + thermal sensing on 42 critical assets with anomaly detection."],
  ["d-sbs-ot", "SBS — OT Network Segmentation", 1_850 * M, "pl-new", "st-proposal", 25, "u-arif", "c-sbs", ["k-teguh", "k-sari"], "medium", "Expansion", "IT / OT", -7, "Zone/conduit redesign of the hot strip mill network to IEC 62443."],
  ["d-bap-crop", "BAP — Drone Crop Health Pilot (Sampit)", 1_250 * M, "pl-new", "st-negotiation", 14, "u-arif", "c-bap-smp", ["k-wulan", "k-yusuf"], "high", "New Business", "Artificial Intelligence", -3, "Multispectral survey of 4,000 ha with Ganoderma early-detection model."],
  ["d-bap-group", "BAP — Group-wide Remote Sensing Programme", 9_800 * M, "pl-new", "st-discovery", 120, "u-rani", "c-bap", ["k-irwan", "k-wulan"], "medium", "New Business", "Artificial Intelligence", -15, "Scale the Sampit pilot to all 11 estates; platform + analytics subscription."],
  ["d-spl-crane", "SPL — Crane Telemetry Phase 2", 3_300 * M, "pl-new", "st-won", -35, "u-rani", "c-spl-tpk", ["k-rizky", "k-fitri"], "high", "Expansion", "Industrial IoT", -35, "Extend STS crane telemetry to 18 RTGs with edge gateways."],
  ["d-spl-twin", "SPL — Terminal Digital Twin", 4_750 * M, "pl-new", "st-solution", 70, "u-rani", "c-spl", ["k-dian", "k-rizky"], "medium", "Expansion", "Full Stack Software Development", -20, "Live yard and equipment twin fed by telemetry + Navis N4."],
  ["d-mge-sensor", "MGE — Wellhead Sensor Network", 2_900 * M, "pl-new", "st-proposal", 21, "u-arif", "c-mge", ["k-eko", "k-laras"], "high", "New Business", "Sensor Integration", -5, "Pressure, temperature and H₂S sensing across 26 wellheads with LoRaWAN backhaul."],
  ["d-mge-ctl", "MGE — Turbine Control Upgrade Study", 480 * M, "pl-new", "st-qualified", 40, "u-arif", "c-mge", ["k-eko"], "low", "New Business", "Control Systems Engineering", -8, "Feasibility study for replacing legacy governor controls on Unit 1."],
  ["d-apg-scada", "APG — SCADA Modernisation Phase 1", 11_500 * M, "pl-new", "st-solution", 95, "u-rani", "c-apg", ["k-joko", "k-ratna"], "high", "New Business", "Control Systems Engineering", -10, "Front-end engineering + replacement of 34 substation RTUs."],
  ["d-cam-uas", "CAM — UAS Maintenance Certification Pack", 1_380 * M, "pl-new", "st-won", -60, "u-sinta", "c-cam", ["k-andre", "k-mega"], "medium", "Expansion", "Engineering Management", -60, "Procedures, tooling and documentation to certify the UAS maintenance line."],
  ["d-cam-renew", "CAM — Engineering Retainer 2027", 2_200 * M, "pl-renew", "st-r-proposal", 50, "u-yoga", "c-cam", ["k-andre"], "medium", "Renewal", "Engineering Management", -9, "Annual engineering retainer — 220 days of on-call engineering support."],
  ["d-bos-rov", "BOS — ROV Autonomy & Sonar Integration", 3_650 * M, "pl-new", "st-qualified", 75, "u-sinta", "c-bos", ["k-hadi", "k-novi"], "high", "New Business", "Unmanned Systems", -6, "Station-keeping autonomy + forward-looking sonar integration on two work-class ROVs."],
  ["d-mcd-iot", "MCD — Smart Streetlight Network", 1_950 * M, "pl-new", "st-discovery", 110, "u-rani", "c-mcd", ["k-gilang"], "low", "New Business", "Industrial IoT", -2, "Connected streetlights with air-quality and flood sensors (phase 1: 1,800 poles)."],
  ["d-rct-fire", "RCT — Peatland Fire Detection UAV", 720 * M, "pl-new", "st-discovery", 85, "u-sinta", "c-rct", ["k-yanti", "k-bayu"], "medium", "New Business", "Unmanned Systems", -12, "Thermal UAV patrols with automatic hotspot alerts to field teams."],
  ["d-twu-nrw", "TWU — Non-Revenue Water Analytics", 2_400 * M, "pl-new", "st-negotiation", 9, "u-arif", "c-twu", ["k-indah", "k-rudy"], "high", "New Business", "Artificial Intelligence", -2, "Pressure/flow sensor fusion + leak localisation model across 6 DMAs."],
  ["d-ptt-insp", "PTT — Drone Tower Inspection Programme", 7_200 * M, "pl-new", "st-proposal", 38, "u-sinta", "c-ptt", ["k-citra", "k-ferry"], "high", "New Business", "Artificial Intelligence", -4, "Automated flight plans + corrosion/defect detection for 2,500 towers/year."],
  ["d-nhs-renew", "NHS — Fleet Support Renewal", 1_600 * M, "pl-renew", "st-r-contract", 12, "u-yoga", "c-nhs", ["k-maya", "k-rina"], "medium", "Renewal", "Unmanned Systems", -5, "Annual support for the USV fleet: spares, field engineers, software updates."],
  ["d-spl-renew", "SPL — Telemetry Platform Renewal", 980 * M, "pl-renew", "st-r-review", 64, "u-yoga", "c-spl", ["k-dian"], "low", "Renewal", "Industrial IoT", -3, "Platform subscription + SLA renewal for crane telemetry."],
  ["d-aam-lost", "AAM — Fixed-wing Survey Drone", 1_100 * M, "pl-new", "st-lost", -80, "u-sinta", "c-aam", ["k-agus"], "low", "New Business", "Unmanned Systems", -80, "Lost on price to an imported airframe; relationship kept warm for VTOL."],
  ["d-sbs-renew", "SBS — Reliability Analytics Renewal", 1_450 * M, "pl-renew", "st-r-won", -20, "u-yoga", "c-sbs", ["k-sari"], "medium", "Renewal", "Industrial IoT", -20, "Renewed for 24 months with expanded asset coverage."],
];

export const deals: Deal[] = dealRows.map(([id, name, amount, pipelineId, stageId, closeDays, ownerId, companyId, contactIds, priority, dealType, capability, stageDays, description], i) => ({
  id,
  name,
  amount,
  pipelineId,
  stageId,
  closeDate: at(closeDays, 17),
  ownerId,
  companyId,
  contactIds,
  priority,
  dealType,
  capability,
  createdAt: at(stageDays - 20 - (i % 25)),
  stageEnteredAt: at(stageDays, 11),
  description,
}));

/* ───────────────────────── tickets ───────────────────────── */

export const tickets: Ticket[] = [
  { id: "t-1001", subject: "USV-02 loses RTK fix near quay wall", description: "Survey launch drops to float solution within 30 m of steel quay; logs attached by customer.", pipelineId: "pl-support", stageId: "ts-escalated", priority: "high", category: "Hardware Fault", companyId: "c-nhs", contactId: "k-hendra", ownerId: "u-putri", createdAt: at(-6, 8), slaDueAt: at(1, 17), closedAt: null },
  { id: "t-1002", subject: "Crane telemetry gaps on RTG-07 overnight", description: "Telemetry dashboard shows 2–3 h gaps between 01:00 and 04:00 on RTG-07 only.", pipelineId: "pl-support", stageId: "ts-escalated", priority: "urgent", category: "Software Defect", companyId: "c-spl-tpk", contactId: "k-rizky", ownerId: "u-putri", createdAt: at(-2, 7), slaDueAt: at(0, 15), closedAt: null },
  { id: "t-1003", subject: "Request: export vibration report as PDF", description: "Reliability team wants monthly vibration summaries exported to PDF for management.", pipelineId: "pl-support", stageId: "ts-progress", priority: "medium", category: "Software Defect", companyId: "c-sbs", contactId: "k-sari", ownerId: "u-yoga", createdAt: at(-9), slaDueAt: at(3), closedAt: null },
  { id: "t-1004", subject: "UAS maintenance manual — rev C clarifications", description: "Two torque values in section 4.3 conflict with the airframe OEM table.", pipelineId: "pl-support", stageId: "ts-waiting", priority: "medium", category: "Documentation", companyId: "c-cam", contactId: "k-mega", ownerId: "u-yoga", createdAt: at(-11), slaDueAt: at(2), closedAt: null },
  { id: "t-1005", subject: "Anomaly alert storm after furnace restart", description: "38 alerts fired in 10 min after planned restart; operators muted the channel.", pipelineId: "pl-support", stageId: "ts-escalated", priority: "high", category: "Software Defect", companyId: "c-sbs", contactId: "k-budi", ownerId: "u-putri", createdAt: at(-3, 14), slaDueAt: at(1, 12), closedAt: null },
  { id: "t-1006", subject: "Gateway GW-14 offline after power cut", description: "Edge gateway did not recover after site power interruption; needs remote reboot or visit.", pipelineId: "pl-support", stageId: "ts-new", priority: "high", category: "Field Support", companyId: "c-spl-tpk", contactId: "k-fitri", ownerId: "u-putri", createdAt: at(0, 7, 40), slaDueAt: at(0, 19), closedAt: null },
  { id: "t-1007", subject: "Operator refresher training for new hires", description: "Four new survey technicians need the USV operator course before December campaign.", pipelineId: "pl-support", stageId: "ts-new", priority: "low", category: "Training", companyId: "c-nhs", contactId: "k-maya", ownerId: "u-yoga", createdAt: at(-1), slaDueAt: at(9), closedAt: null },
  { id: "t-1008", subject: "Dashboard login loop on Safari", description: "Users on Safari 18 get redirected back to login after SSO.", pipelineId: "pl-support", stageId: "ts-resolved", priority: "medium", category: "Software Defect", companyId: "c-spl", contactId: "k-dian", ownerId: "u-yoga", createdAt: at(-19), slaDueAt: at(-15), closedAt: at(-16) },
  { id: "t-1009", subject: "Spare propulsion pod lead time", description: "Customer needs confirmation of pod availability for January dry-dock.", pipelineId: "pl-support", stageId: "ts-progress", priority: "medium", category: "Field Support", companyId: "c-nhs", contactId: "k-rina", ownerId: "u-putri", createdAt: at(-4), slaDueAt: at(4), closedAt: null },
];

/* ───────────────────────── products & line items ───────────────────────── */

export const products: Product[] = [
  { id: "p-vtol", sku: "SG-UAV-VTOL", name: "VTOL Survey UAV — airframe & avionics", description: "Long-endurance VTOL with dual-redundant autopilot, 2.5 kg payload bay.", unitPrice: 720 * M, billing: "one_time", category: "Unmanned Systems" },
  { id: "p-gcs", sku: "SG-UAV-GCS", name: "Ground Control Station (rugged)", description: "Field GCS with long-range datalink and mission planning suite.", unitPrice: 185 * M, billing: "one_time", category: "Unmanned Systems" },
  { id: "p-asv", sku: "SG-USV-KIT", name: "Vessel Autonomy Retrofit Kit", description: "Autopilot, perception stack and remote ops link for vessels up to 12 m.", unitPrice: 2_950 * M, billing: "one_time", category: "Unmanned Systems" },
  { id: "p-aivis", sku: "SG-AI-VIS", name: "AI Inspection Model Licence", description: "Per-site licence for defect/condition detection models incl. retraining.", unitPrice: 340 * M, billing: "annual", category: "Artificial Intelligence" },
  { id: "p-sns", sku: "SG-SNS-PKG", name: "Sensor Integration Package", description: "Sensor selection, mounting, calibration and data pipeline per asset class.", unitPrice: 95 * M, billing: "one_time", category: "Sensor Integration" },
  { id: "p-gw", sku: "SG-IOT-GW", name: "IIoT Edge Gateway", description: "Industrial edge gateway, dual SIM + Ethernet, store-and-forward.", unitPrice: 38 * M, billing: "one_time", category: "Industrial IoT" },
  { id: "p-plat", sku: "SG-IOT-PLAT", name: "IIoT Platform Subscription", description: "Telemetry platform, dashboards and alerting — per 50 assets.", unitPrice: 42 * M, billing: "monthly", category: "Industrial IoT" },
  { id: "p-ctl", sku: "SG-CTL-ENG", name: "Control Systems Engineering Package", description: "FEED, functional design spec and FAT for control upgrades.", unitPrice: 1_150 * M, billing: "one_time", category: "Control Systems Engineering" },
  { id: "p-day", sku: "SG-ENG-DAY", name: "Senior Engineering Day", description: "On-site or remote senior engineer, per day.", unitPrice: 9_500_000, billing: "one_time", category: "Engineering Management" },
  { id: "p-proto", sku: "SG-PRT-RUN", name: "Prototype Build Run", description: "In-house light manufacturing run incl. ground test report.", unitPrice: 260 * M, billing: "one_time", category: "Prototyping & Manufacturing" },
  { id: "p-sprint", sku: "SG-SW-SPRINT", name: "Software Delivery Sprint (2 wks)", description: "Cross-functional squad: 2 engineers, 1 designer, part-time PM.", unitPrice: 310 * M, billing: "one_time", category: "Full Stack Software Development" },
  { id: "p-cert", sku: "SG-DOC-CERT", name: "Certification Documentation Pack", description: "Traceable requirements, test evidence and certifiable artifacts.", unitPrice: 420 * M, billing: "one_time", category: "Engineering Management" },
  { id: "p-train", sku: "SG-TRN-OPS", name: "Operator Training Course (per seat)", description: "5-day operator course with practical assessment.", unitPrice: 28 * M, billing: "one_time", category: "Engineering Management" },
];

export const lineItems: LineItem[] = [
  { id: "li-1", dealId: "d-nhs-asv", productId: "p-asv", quantity: 2, unitPrice: 2_950 * M, discountPct: 5 },
  { id: "li-2", dealId: "d-nhs-asv", productId: "p-day", quantity: 60, unitPrice: 9_500_000, discountPct: 0 },
  { id: "li-3", dealId: "d-nhs-asv", productId: "p-train", quantity: 12, unitPrice: 28 * M, discountPct: 10 },
  { id: "li-4", dealId: "d-aam-vtol", productId: "p-vtol", quantity: 6, unitPrice: 720 * M, discountPct: 8 },
  { id: "li-5", dealId: "d-aam-vtol", productId: "p-gcs", quantity: 3, unitPrice: 185 * M, discountPct: 0 },
  { id: "li-6", dealId: "d-ptt-insp", productId: "p-aivis", quantity: 10, unitPrice: 340 * M, discountPct: 12 },
  { id: "li-7", dealId: "d-ptt-insp", productId: "p-vtol", quantity: 4, unitPrice: 720 * M, discountPct: 10 },
  { id: "li-8", dealId: "d-twu-nrw", productId: "p-sns", quantity: 12, unitPrice: 95 * M, discountPct: 0 },
  { id: "li-9", dealId: "d-twu-nrw", productId: "p-aivis", quantity: 3, unitPrice: 340 * M, discountPct: 5 },
  { id: "li-10", dealId: "d-mge-sensor", productId: "p-sns", quantity: 26, unitPrice: 95 * M, discountPct: 4 },
  { id: "li-11", dealId: "d-mge-sensor", productId: "p-gw", quantity: 8, unitPrice: 38 * M, discountPct: 0 },
  { id: "li-12", dealId: "d-bap-crop", productId: "p-aivis", quantity: 1, unitPrice: 340 * M, discountPct: 0 },
  { id: "li-13", dealId: "d-bap-crop", productId: "p-vtol", quantity: 1, unitPrice: 720 * M, discountPct: 0 },
  { id: "li-14", dealId: "d-bap-crop", productId: "p-train", quantity: 6, unitPrice: 28 * M, discountPct: 0 },
  { id: "li-15", dealId: "d-sbs-pdm", productId: "p-sns", quantity: 42, unitPrice: 95 * M, discountPct: 6 },
  { id: "li-16", dealId: "d-sbs-pdm", productId: "p-plat", quantity: 24, unitPrice: 42 * M, discountPct: 0 },
  { id: "li-17", dealId: "d-sbs-ot", productId: "p-day", quantity: 120, unitPrice: 9_500_000, discountPct: 0 },
  { id: "li-18", dealId: "d-sbs-ot", productId: "p-cert", quantity: 1, unitPrice: 420 * M, discountPct: 0 },
  { id: "li-19", dealId: "d-apg-scada", productId: "p-ctl", quantity: 6, unitPrice: 1_150 * M, discountPct: 3 },
];

const snapshot = (dealId: string) =>
  lineItems.filter((l) => l.dealId === dealId).map(({ dealId: _d, ...rest }) => ({ ...rest, id: rest.id.replace("li-", "qli-") }));

export const quotes: Quote[] = [
  { id: "q-1", number: "SGQ-2026-0141", dealId: "d-nhs-asv", title: "Autonomous Survey Vessel Retrofit — 2 vessels", status: "pending_approval", ownerId: "u-sinta", createdAt: at(-4), expiresAt: at(26), lineItems: snapshot("d-nhs-asv"), taxPct: 11 },
  { id: "q-2", number: "SGQ-2026-0138", dealId: "d-twu-nrw", title: "NRW Analytics — 6 DMAs", status: "sent", ownerId: "u-arif", createdAt: at(-7), expiresAt: at(23), lineItems: snapshot("d-twu-nrw"), taxPct: 11 },
  { id: "q-3", number: "SGQ-2026-0132", dealId: "d-sbs-pdm", title: "Blast Furnace Predictive Maintenance", status: "signed", ownerId: "u-arif", createdAt: at(-30), expiresAt: at(0), lineItems: snapshot("d-sbs-pdm"), taxPct: 11 },
  { id: "q-4", number: "SGQ-2026-0144", dealId: "d-ptt-insp", title: "Drone Tower Inspection — Year 1", status: "draft", ownerId: "u-sinta", createdAt: at(-1), expiresAt: at(29), lineItems: snapshot("d-ptt-insp"), taxPct: 11 },
  { id: "q-5", number: "SGQ-2026-0143", dealId: "d-bap-crop", title: "Sampit Crop Health Pilot", status: "approved", ownerId: "u-arif", createdAt: at(-2), expiresAt: at(28), lineItems: snapshot("d-bap-crop"), taxPct: 11 },
];

/* ───────────────────────── agile: projects, sprints, epics ───────────────────────── */

export const projects: Project[] = [
  { id: "pr-uav", key: "UAV", name: "Unmanned Systems Programmes", leadId: "u-ayu", description: "Airframes, vessels, autonomy and payload integration.", color: "green" },
  { id: "pr-iot", key: "IOT", name: "Industrial IoT & Control", leadId: "u-dimas", description: "Sensing, edge gateways, SCADA and control-system delivery.", color: "cyan" },
  { id: "pr-swd", key: "SWD", name: "Software & AI Delivery", leadId: "u-fajar", description: "Platforms, dashboards, AI models and customer-facing software.", color: "blue" },
];

export const sprints: Sprint[] = [
  { id: "sp-uav-23", projectId: "pr-uav", name: "UAV Sprint 23", goal: "Close NHS sea-trial findings", startDate: at(-23), endDate: at(-10), state: "closed", capacity: 34 },
  { id: "sp-uav-24", projectId: "pr-uav", name: "UAV Sprint 24", goal: "Retrofit kit v2 ready for NHS acceptance; VTOL payload integration", startDate: at(-9), endDate: at(4), state: "active", capacity: 36 },
  { id: "sp-uav-25", projectId: "pr-uav", name: "UAV Sprint 25", goal: "AAM VTOL demo flights", startDate: at(5), endDate: at(18), state: "future", capacity: 36 },
  { id: "sp-iot-31", projectId: "pr-iot", name: "IOT Sprint 31", goal: "SPL RTG rollout batch 1", startDate: at(-23), endDate: at(-10), state: "closed", capacity: 30 },
  { id: "sp-iot-32", projectId: "pr-iot", name: "IOT Sprint 32", goal: "Telemetry reliability + SBS alert tuning", startDate: at(-9), endDate: at(4), state: "active", capacity: 32 },
  { id: "sp-iot-33", projectId: "pr-iot", name: "IOT Sprint 33", goal: "MGE wellhead pilot hardware", startDate: at(5), endDate: at(18), state: "future", capacity: 32 },
  { id: "sp-swd-17", projectId: "pr-swd", name: "SWD Sprint 17", goal: "Seabed classifier baseline", startDate: at(-23), endDate: at(-10), state: "closed", capacity: 40 },
  { id: "sp-swd-18", projectId: "pr-swd", name: "SWD Sprint 18", goal: "Tower defect model v1 + NRW leak localisation POC", startDate: at(-9), endDate: at(4), state: "active", capacity: 42 },
  { id: "sp-swd-19", projectId: "pr-swd", name: "SWD Sprint 19", goal: "Terminal digital twin discovery", startDate: at(5), endDate: at(18), state: "future", capacity: 42 },
];

export const epics: Epic[] = [
  { id: "e-asv", projectId: "pr-uav", key: "UAV-1", name: "NHS Vessel Autonomy Retrofit", summary: "Deliver autonomy kit v2 to two NHS survey launches.", color: "green", status: "in_progress", ownerId: "u-ayu" },
  { id: "e-vtol", projectId: "pr-uav", key: "UAV-2", name: "VTOL LiDAR Payload Integration", summary: "Integrate LiDAR payload and mapping workflow for AAM fleet.", color: "yellow", status: "in_progress", ownerId: "u-ayu" },
  { id: "e-crane", projectId: "pr-iot", key: "IOT-1", name: "SPL Crane Telemetry Phase 2", summary: "18 RTGs on telemetry with edge buffering.", color: "cyan", status: "in_progress", ownerId: "u-dimas" },
  { id: "e-pdm", projectId: "pr-iot", key: "IOT-2", name: "SBS Predictive Maintenance Onboarding", summary: "Closed-won onboarding: 42 assets instrumented and tuned.", color: "orange", status: "in_progress", ownerId: "u-dimas" },
  { id: "e-well", projectId: "pr-iot", key: "IOT-3", name: "MGE Wellhead Sensor Pilot", summary: "Pre-sales pilot hardware for 4 wellheads.", color: "red", status: "todo", ownerId: "u-dimas" },
  { id: "e-seabed", projectId: "pr-swd", key: "SWD-1", name: "Seabed Classification Model", summary: "Backscatter → seabed class model with QC tooling.", color: "blue", status: "in_progress", ownerId: "u-kevin" },
  { id: "e-tower", projectId: "pr-swd", key: "SWD-2", name: "Tower Defect Detection", summary: "Corrosion / bolt / antenna defect detection for PTT.", color: "magenta", status: "in_progress", ownerId: "u-kevin" },
  { id: "e-nrw", projectId: "pr-swd", key: "SWD-3", name: "NRW Leak Localisation", summary: "Pressure/flow sensor fusion for TWU DMAs.", color: "cyan", status: "todo", ownerId: "u-nadia" },
];

/* ───────────────────────── issues ───────────────────────── */

type I = [key: string, type: IssueType, summary: string, status: IssueStatus, priority: IssuePriority, assignee: string | null, epic: string | null, sprint: string | null, points: number | null, labels: string[], parentKey?: string];

const issueRows: I[] = [
  // UAV
  ["UAV-101", "story", "Obstacle detection: fuse radar + camera tracks for quay approach", "in_progress", "high", "u-ayu", "e-asv", "sp-uav-24", 8, ["autonomy", "nhs"]],
  ["UAV-102", "bug", "RTK float near steel quay walls (multipath)", "in_progress", "highest", "u-ayu", "e-asv", "sp-uav-24", 5, ["gnss", "field"]],
  ["UAV-103", "task", "Remote-ops link failover to 4G when LOS lost", "in_review", "high", "u-dimas", "e-asv", "sp-uav-24", 5, ["comms"]],
  ["UAV-104", "story", "Acceptance test procedure for retrofit kit v2", "todo", "medium", "u-bima", "e-asv", "sp-uav-24", 3, ["cert"]],
  ["UAV-105", "deal_action", "Prepare autonomy demo video for NHS negotiation", "todo", "high", "u-ayu", "e-asv", "sp-uav-24", 2, ["sales-support"]],
  ["UAV-106", "story", "LiDAR payload mounting + vibration isolation", "in_progress", "medium", "u-ayu", "e-vtol", "sp-uav-24", 5, ["vtol", "aam"]],
  ["UAV-107", "task", "Payload power budget analysis at max endurance", "done", "medium", "u-dimas", "e-vtol", "sp-uav-24", 3, ["vtol"]],
  ["UAV-108", "story", "GCS mission template for corridor mapping", "todo", "medium", "u-nadia", "e-vtol", "sp-uav-24", 3, ["gcs"]],
  ["UAV-109", "bug", "Battery telemetry reports 0% after hot-swap", "done", "high", "u-dimas", "e-vtol", "sp-uav-24", 2, ["vtol"]],
  ["UAV-110", "task", "Demo flight plan & NOTAM paperwork for AAM", "backlog", "medium", "u-ayu", "e-vtol", "sp-uav-25", 2, ["aam", "ops"]],
  ["UAV-111", "story", "Thermal hotspot detection payload trade study (RCT)", "backlog", "low", null, null, null, 5, ["presales"]],
  ["UAV-112", "support_escalation", "USV-02 RTK dropouts escalated from field support", "in_progress", "highest", "u-ayu", "e-asv", "sp-uav-24", 3, ["escalation"]],
  ["UAV-113", "task", "Sea-trial report rev B", "done", "medium", "u-bima", "e-asv", "sp-uav-23", 2, ["cert"]],
  ["UAV-114", "subtask", "Collect multipath logs from NHS launch", "done", "high", "u-ayu", "e-asv", "sp-uav-24", 1, ["gnss"], "UAV-102"],
  ["UAV-115", "subtask", "Test dual-antenna heading config", "in_progress", "high", "u-dimas", "e-asv", "sp-uav-24", 2, ["gnss"], "UAV-102"],
  ["UAV-116", "story", "ROV station-keeping controller prototype (BOS)", "backlog", "medium", null, null, null, 8, ["presales", "rov"]],
  // IOT
  ["IOT-201", "bug", "Telemetry gaps on RTG-07 between 01:00–04:00", "in_progress", "highest", "u-dimas", "e-crane", "sp-iot-32", 5, ["spl", "telemetry"]],
  ["IOT-202", "story", "Store-and-forward buffer on edge gateways (72 h)", "in_review", "high", "u-nadia", "e-crane", "sp-iot-32", 8, ["edge"]],
  ["IOT-203", "task", "Install gateways on RTG-13 to RTG-18", "todo", "medium", "u-dimas", "e-crane", "sp-iot-32", 3, ["field", "spl"]],
  ["IOT-204", "support_escalation", "GW-14 offline after power cut — watchdog investigation", "todo", "high", "u-dimas", "e-crane", "sp-iot-32", 2, ["escalation"]],
  ["IOT-205", "bug", "Alert storm after furnace restart (missing warm-up suppression)", "in_progress", "highest", "u-kevin", "e-pdm", "sp-iot-32", 5, ["sbs", "alerts"]],
  ["IOT-206", "story", "Per-asset alert thresholds with maintenance windows", "todo", "high", "u-nadia", "e-pdm", "sp-iot-32", 5, ["alerts"]],
  ["IOT-207", "task", "Commission vibration sensors on BF-2 cooling fans", "done", "medium", "u-dimas", "e-pdm", "sp-iot-32", 3, ["field", "sbs"]],
  ["IOT-208", "story", "Monthly vibration report PDF export", "todo", "medium", "u-nadia", "e-pdm", "sp-iot-32", 3, ["reporting"]],
  ["IOT-209", "deal_action", "Wellhead sensor BOM + LoRaWAN coverage survey for MGE proposal", "in_progress", "high", "u-dimas", "e-well", "sp-iot-32", 3, ["presales", "mge"]],
  ["IOT-210", "story", "H₂S sensor enclosure rated for geothermal environment", "backlog", "medium", null, "e-well", "sp-iot-33", 5, ["mge", "hardware"]],
  ["IOT-211", "deal_action", "SCADA RTU inventory and FEED estimate for APG", "todo", "high", "u-fajar", null, "sp-iot-32", 5, ["presales", "apg"]],
  ["IOT-212", "task", "RTG batch 1 handover documentation", "done", "low", "u-bima", "e-crane", "sp-iot-31", 2, ["docs"]],
  ["IOT-213", "story", "Streetlight node reference design (MCD)", "backlog", "low", null, null, null, 8, ["presales"]],
  ["IOT-214", "subtask", "Reproduce RTG-07 gap with gateway debug logging", "done", "highest", "u-dimas", "e-crane", "sp-iot-32", 1, ["telemetry"], "IOT-201"],
  ["IOT-215", "subtask", "Check cellular modem sleep policy", "in_progress", "highest", "u-nadia", "e-crane", "sp-iot-32", 2, ["telemetry"], "IOT-201"],
  // SWD
  ["SWD-301", "story", "Seabed classifier: train on NHS 2025 campaign data", "in_review", "high", "u-kevin", "e-seabed", "sp-swd-18", 8, ["ml", "nhs"]],
  ["SWD-302", "story", "QC viewer for classified mosaics", "in_progress", "medium", "u-nadia", "e-seabed", "sp-swd-18", 5, ["frontend"]],
  ["SWD-303", "story", "Tower defect model v1 — corrosion + missing bolts", "in_progress", "highest", "u-kevin", "e-tower", "sp-swd-18", 13, ["ml", "ptt"]],
  ["SWD-304", "task", "Label 4,000 tower images (vendor batch 2)", "in_progress", "high", "u-bima", "e-tower", "sp-swd-18", 3, ["data"]],
  ["SWD-305", "deal_action", "Defect detection accuracy report for PTT proposal", "todo", "high", "u-kevin", "e-tower", "sp-swd-18", 3, ["presales", "ptt"]],
  ["SWD-306", "story", "Leak localisation POC on DMA-3 historic data", "in_progress", "high", "u-nadia", "e-nrw", "sp-swd-18", 8, ["ml", "twu"]],
  ["SWD-307", "deal_action", "NRW ROI model for TWU negotiation", "in_review", "high", "u-kevin", "e-nrw", "sp-swd-18", 2, ["presales", "twu"]],
  ["SWD-308", "bug", "Dashboard login loop on Safari after SSO", "done", "medium", "u-nadia", null, "sp-swd-18", 2, ["auth"]],
  ["SWD-309", "story", "Terminal digital twin — data model for yard blocks", "backlog", "medium", null, null, "sp-swd-19", 5, ["spl", "twin"]],
  ["SWD-310", "story", "Crop health model: Ganoderma early-detection baseline", "todo", "high", "u-kevin", null, "sp-swd-18", 8, ["ml", "bap"]],
  ["SWD-311", "task", "Multispectral flight data pipeline (BAP pilot)", "backlog", "medium", "u-nadia", null, "sp-swd-19", 5, ["bap", "data"]],
  ["SWD-312", "story", "Customer portal: ticket status page", "backlog", "low", null, null, null, 5, ["portal"]],
  ["SWD-313", "story", "Seabed class legend + export to S-57 attributes", "todo", "medium", "u-nadia", "e-seabed", "sp-swd-18", 3, ["frontend"]],
  ["SWD-314", "task", "Seabed baseline evaluation report", "done", "medium", "u-kevin", "e-seabed", "sp-swd-17", 3, ["ml"]],
];

const projectByKey: Record<string, string> = { UAV: "pr-uav", IOT: "pr-iot", SWD: "pr-swd" };
const reporters = ["u-fajar", "u-rani", "u-putri", "u-sinta", "u-arif", "u-yoga"];

export const issues: Issue[] = (() => {
  const rankByStatus: Record<string, number> = {};
  return issueRows.map(([key, type, summary, status, priority, assigneeId, epicId, sprintId, storyPoints, labels], i) => {
    const projectId = projectByKey[key.split("-")[0]];
    const bucket = `${projectId}:${status}`;
    rankByStatus[bucket] = (rankByStatus[bucket] ?? 0) + 1000;
    const created = -40 + ((i * 17) % 36);
    return {
      id: `i-${key.toLowerCase()}`,
      key,
      projectId,
      type,
      summary,
      description: describeIssue(type, summary),
      status,
      priority,
      assigneeId,
      reporterId: type === "support_escalation" ? "u-putri" : type === "deal_action" ? pick(["u-rani", "u-sinta", "u-arif"]) : reporters[i % reporters.length],
      epicId,
      sprintId,
      parentId: null,
      storyPoints,
      labels,
      rank: rankByStatus[bucket],
      createdAt: at(created, 10),
      updatedAt: at(Math.min(0, created + between(2, 30)), between(9, 18)),
      dueDate: sprintId ? sprints.find((s) => s.id === sprintId)?.endDate ?? null : null,
    } satisfies Issue;
  });
})();
// resolve subtask parents
issueRows.forEach(([key, , , , , , , , , , parentKey]) => {
  if (!parentKey) return;
  const child = issues.find((x) => x.key === key);
  const parent = issues.find((x) => x.key === parentKey);
  if (child && parent) child.parentId = parent.id;
});

function describeIssue(type: IssueType, summary: string) {
  switch (type) {
    case "bug":
      return `**Observed:** ${summary}.\n\n**Expected:** behaviour within spec under normal field conditions.\n\n**Steps / evidence:** see linked field logs and support ticket. Reproduce on bench before deploying a fix.`;
    case "deal_action":
      return `Sales-support work needed to move the linked deal forward.\n\n**Deliverable:** ${summary}.\n**Done when:** the account executive has the material and confirms it in the deal timeline.`;
    case "support_escalation":
      return `Escalated from Field Support after first-line triage.\n\n**Customer impact:** degraded operations at site. Keep the linked ticket updated — resolving this issue resolves the ticket.`;
    case "subtask":
      return `Sub-task: ${summary}.`;
    default:
      return `${summary}.\n\n**Acceptance criteria**\n- Meets the agreed requirement and passes bench/field test\n- Documentation updated in the delivery record\n- Reviewed by a second engineer`;
  }
}

export const issueComments: IssueComment[] = [
  { id: "ic-1", issueId: "i-uav-102", authorId: "u-ayu", body: "Multipath confirmed — float solution correlates with heading toward the quay. Trying dual-antenna heading next.", createdAt: at(-3, 15) },
  { id: "ic-2", issueId: "i-uav-102", authorId: "u-putri", body: "Customer asks for an ETA; their next campaign starts on the 18th.", createdAt: at(-2, 10) },
  { id: "ic-3", issueId: "i-iot-201", authorId: "u-dimas", body: "Gap reproduced. Modem enters deep sleep when the RTG is parked — gateway thinks link is up.", createdAt: at(-1, 16) },
  { id: "ic-4", issueId: "i-iot-205", authorId: "u-kevin", body: "Root cause: no warm-up suppression after restart. Adding a 45-min ramp window per asset class.", createdAt: at(-1, 11) },
  { id: "ic-5", issueId: "i-swd-303", authorId: "u-kevin", body: "mAP@0.5 at 0.81 on the validation set; bolts class still weak (0.64).", createdAt: at(-2, 17) },
  { id: "ic-6", issueId: "i-swd-307", authorId: "u-arif", body: "Customer wants the payback period shown per DMA, not just total.", createdAt: at(-1, 9) },
];

/* ───────────────────────── cross-domain links ───────────────────────── */

const L = (id: string, agileId: string, crmType: CrossLink["crmType"], crmId: string, linkType: CrossLink["linkType"], days: number, by: string, agileType: CrossLink["agileType"] = "issue"): CrossLink => ({
  id,
  agileType,
  agileId,
  crmType,
  crmId,
  linkType,
  createdAt: at(days),
  createdById: by,
});

export const crossLinks: CrossLink[] = [
  L("x-1", "i-uav-102", "deal", "d-nhs-asv", "blocks", -5, "u-sinta"),
  L("x-2", "i-uav-112", "ticket", "t-1001", "escalated_from", -5, "u-putri"),
  L("x-3", "i-uav-105", "deal", "d-nhs-asv", "implements", -6, "u-sinta"),
  L("x-4", "i-uav-102", "company", "c-nhs", "relates_to", -5, "u-ayu"),
  L("x-5", "i-uav-112", "contact", "k-hendra", "relates_to", -5, "u-putri"),
  L("x-6", "i-iot-201", "ticket", "t-1002", "escalated_from", -2, "u-putri"),
  L("x-7", "i-iot-201", "deal", "d-spl-renew", "blocks", -2, "u-yoga"),
  L("x-8", "i-iot-204", "ticket", "t-1006", "escalated_from", 0, "u-putri"),
  L("x-9", "i-iot-205", "ticket", "t-1005", "escalated_from", -3, "u-putri"),
  L("x-10", "i-iot-208", "ticket", "t-1003", "implements", -8, "u-yoga"),
  L("x-11", "i-iot-209", "deal", "d-mge-sensor", "implements", -5, "u-arif"),
  L("x-12", "i-iot-211", "deal", "d-apg-scada", "implements", -9, "u-rani"),
  L("x-13", "i-swd-305", "deal", "d-ptt-insp", "implements", -4, "u-sinta"),
  L("x-14", "i-swd-303", "deal", "d-ptt-insp", "blocks", -4, "u-sinta"),
  L("x-15", "i-swd-307", "deal", "d-twu-nrw", "implements", -3, "u-arif"),
  L("x-16", "i-swd-306", "deal", "d-twu-nrw", "relates_to", -6, "u-arif"),
  L("x-17", "i-swd-308", "ticket", "t-1008", "escalated_from", -18, "u-yoga"),
  L("x-18", "i-swd-310", "deal", "d-bap-crop", "blocks", -3, "u-arif"),
  L("x-19", "i-swd-301", "deal", "d-nhs-ai", "implements", -9, "u-sinta"),
  L("x-20", "i-uav-106", "deal", "d-aam-vtol", "implements", -10, "u-sinta"),
  L("x-21", "e-pdm", "deal", "d-sbs-pdm", "implements", -12, "u-arif", "epic"),
  L("x-22", "e-crane", "deal", "d-spl-crane", "implements", -35, "u-rani", "epic"),
  L("x-23", "e-asv", "deal", "d-nhs-asv", "relates_to", -20, "u-sinta", "epic"),
  L("x-24", "e-tower", "company", "c-ptt", "relates_to", -15, "u-kevin", "epic"),
  L("x-25", "i-iot-205", "company", "c-sbs", "relates_to", -3, "u-kevin"),
  L("x-26", "i-iot-205", "contact", "k-budi", "relates_to", -3, "u-putri"),
  L("x-27", "i-swd-306", "contact", "k-indah", "relates_to", -6, "u-nadia"),
  L("x-28", "i-uav-111", "deal", "d-rct-fire", "implements", -10, "u-sinta"),
  L("x-29", "i-uav-116", "deal", "d-bos-rov", "implements", -6, "u-sinta"),
  L("x-30", "i-iot-213", "deal", "d-mcd-iot", "implements", -2, "u-rani"),
];

/* ───────────────────────── activities ───────────────────────── */

const emptyLinks = () => ({ contactIds: [] as string[], companyIds: [] as string[], dealIds: [] as string[], ticketIds: [] as string[] });
let actSeq = 0;
const act = (type: ActivityType, subject: string, body: string, days: number, hour: number, ownerId: string, links: Partial<ReturnType<typeof emptyLinks>>, extra: Partial<Activity> = {}): Activity => ({
  id: `a-${++actSeq}`,
  type,
  subject,
  body,
  timestamp: at(days, hour, (actSeq * 11) % 60),
  ownerId,
  links: { ...emptyLinks(), ...links },
  ...extra,
});

const handwritten: Activity[] = [
  act("meeting", "Negotiation call — retrofit commercial terms", "Rina and Maya on the call. Agreed: 2 vessels, phased payment 40/40/20, acceptance at Tanjung Priok. Open: liquidated damages cap (they want 10%, we offered 5%). Hendra wants the RTK issue closed before signature.", -1, 14, "u-sinta", { contactIds: ["k-rina", "k-maya", "k-hendra"], companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"] }, { durationMin: 60, pinned: true }),
  act("email", "Re: Retrofit kit v2 — acceptance criteria", "Hi Rina,\n\nAttached is the draft acceptance test procedure (rev A). We propose a two-day harbour trial followed by one survey line under autonomy. Let us know if your team wants additional obstacle scenarios.\n\nBest,\nSinta", -2, 10, "u-sinta", { contactIds: ["k-rina"], companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"] }, { direction: "outbound" }),
  act("email", "RTK dropouts — still happening", "Sinta, our crew saw the same float-solution issue again on Monday near Pier 3. We need this resolved before we sign anything. — Hendra", -3, 8, "u-sinta", { contactIds: ["k-hendra"], companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"], ticketIds: ["t-1001"] }, { direction: "inbound" }),
  act("call", "Call with Hendra — RTK issue status", "Explained root cause hypothesis (multipath from steel quay). Ayu is testing a dual-antenna config this week. Hendra OK to continue negotiation in parallel.", -2, 16, "u-sinta", { contactIds: ["k-hendra"], companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"] }, { callOutcome: "connected", durationMin: 18, direction: "outbound" }),
  act("task", "Send revised LD clause to NHS legal", "Draft with 7.5% cap as compromise; get Bennaya sign-off first.", 0, 9, "u-sinta", { contactIds: ["k-maya"], companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"] }, { dueAt: at(1, 12), done: false }),
  act("task", "Book sea-trial slot at Priok", "Coordinate with harbour master for 2 days in the week of the 16th.", -1, 11, "u-ayu", { companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"] }, { dueAt: at(3, 17), done: false }),
  act("note", "Budget confirmed for FY27", "Maya confirmed the retrofit is in their FY27 capex; PO can be raised in December if signed by the 25th.", -4, 15, "u-sinta", { contactIds: ["k-maya"], companyIds: ["c-nhs"], dealIds: ["d-nhs-asv"] }),
  act("meeting", "Sampit pilot — field visit", "Walked 3 blocks with Yusuf. Ganoderma visible in block C7; good candidate for ground truth. They can provide 2 agronomists for labelling.", -8, 9, "u-arif", { contactIds: ["k-yusuf", "k-wulan"], companyIds: ["c-bap-smp", "c-bap"], dealIds: ["d-bap-crop"] }, { durationMin: 240 }),
  act("email", "Pilot proposal — Sampit crop health", "Wulan, please find the pilot proposal attached. Pricing assumes one VTOL on loan for the 3-month pilot.", -5, 13, "u-arif", { contactIds: ["k-wulan"], companyIds: ["c-bap"], dealIds: ["d-bap-crop"] }, { direction: "outbound" }),
  act("call", "Wulan — pilot scope questions", "She wants the model to flag trees, not just blocks. Asked Kevin whether per-tree is feasible at 3 cm GSD.", -3, 11, "u-arif", { contactIds: ["k-wulan"], companyIds: ["c-bap"], dealIds: ["d-bap-crop"] }, { callOutcome: "connected", durationMin: 24, direction: "inbound" }),
  act("meeting", "Steering committee — predictive maintenance kickoff", "Kick-off held. 42 assets confirmed. Budi named Sari as day-to-day owner. Weekly status every Thursday.", -10, 10, "u-arif", { contactIds: ["k-budi", "k-sari"], companyIds: ["c-sbs"], dealIds: ["d-sbs-pdm"] }, { durationMin: 90 }),
  act("email", "Alert storm on Friday", "Arif, after the BF-2 restart the system raised dozens of alerts and the operators muted it. Please advise urgently. — Budi", -3, 15, "u-arif", { contactIds: ["k-budi"], companyIds: ["c-sbs"], ticketIds: ["t-1005"] }, { direction: "inbound" }),
  act("call", "Joko — SCADA scope walk-through", "34 RTUs across 12 substations; mix of 3 vendors. They want FEED first, then fixed-price phase 1.", -2, 10, "u-rani", { contactIds: ["k-joko"], companyIds: ["c-apg"], dealIds: ["d-apg-scada"] }, { callOutcome: "connected", durationMin: 41, direction: "outbound" }),
  act("call", "Ratna — intro attempt", "No answer, left voicemail referencing Joko's FEED request.", -18, 15, "u-rani", { contactIds: ["k-ratna"], companyIds: ["c-apg"], dealIds: ["d-apg-scada"] }, { callOutcome: "left_voicemail", durationMin: 1, direction: "outbound" }),
  act("meeting", "PTT — inspection programme workshop", "Citra + Ferry + 3 regional maintenance leads. Key metric: inspections/day and defect recall. They benchmark against rope-access teams.", -6, 9, "u-sinta", { contactIds: ["k-citra", "k-ferry"], companyIds: ["c-ptt"], dealIds: ["d-ptt-insp"] }, { durationMin: 180 }),
  act("email", "Accuracy numbers for the board pack", "Hi Sinta, our board meets on the 20th. Can you share defect detection accuracy figures by then? — Citra", -2, 9, "u-sinta", { contactIds: ["k-citra"], companyIds: ["c-ptt"], dealIds: ["d-ptt-insp"] }, { direction: "inbound" }),
  act("task", "Get accuracy report from Kevin (SWD-305)", "Needed for PTT board pack on the 20th.", -1, 10, "u-sinta", { contactIds: ["k-citra"], companyIds: ["c-ptt"], dealIds: ["d-ptt-insp"] }, { dueAt: at(5, 12), done: false }),
  act("meeting", "TWU — commercial negotiation", "Indah supportive; Rudy concerned about sensor install disruption. Agreed to stage installs during night maintenance windows.", -2, 13, "u-arif", { contactIds: ["k-indah", "k-rudy"], companyIds: ["c-twu"], dealIds: ["d-twu-nrw"] }, { durationMin: 75 }),
  act("call", "Rizky — RTG-07 gaps", "Gaps are hurting their crane productivity KPIs. Promised daily updates until fixed.", -2, 8, "u-putri", { contactIds: ["k-rizky"], companyIds: ["c-spl-tpk"], ticketIds: ["t-1002"] }, { callOutcome: "connected", durationMin: 12, direction: "inbound" }),
  act("email", "Daily update — RTG-07 telemetry", "Root cause narrowed to modem power-saving while the crane is parked. Fix candidate on bench now.", -1, 17, "u-putri", { contactIds: ["k-rizky", "k-fitri"], companyIds: ["c-spl-tpk"], ticketIds: ["t-1002"], dealIds: ["d-spl-renew"] }, { direction: "outbound" }),
  act("note", "Renewal risk — telemetry reliability", "Dian mentioned in passing that renewal depends on Q4 uptime. Flagging IOT-201 as renewal blocker.", -2, 12, "u-yoga", { contactIds: ["k-dian"], companyIds: ["c-spl"], dealIds: ["d-spl-renew"] }),
  act("meeting", "AAM — VTOL solution design review", "Agus walked through 3 corridor projects. LiDAR choice narrowed to 2 options. Lina needs leasing option priced.", -9, 13, "u-sinta", { contactIds: ["k-agus", "k-lina"], companyIds: ["c-aam"], dealIds: ["d-aam-vtol"] }, { durationMin: 120 }),
  act("task", "Price a 36-month lease option for AAM", "Lina (Finance) asked for lease vs buy comparison.", -8, 10, "u-sinta", { contactIds: ["k-lina"], companyIds: ["c-aam"], dealIds: ["d-aam-vtol"] }, { dueAt: at(-1, 17), done: false }),
  act("email", "Wellhead pilot — proposal", "Eko, attached is our proposal for the 26-wellhead sensor network with a 4-wellhead pilot option.", -5, 11, "u-arif", { contactIds: ["k-eko", "k-laras"], companyIds: ["c-mge"], dealIds: ["d-mge-sensor"] }, { direction: "outbound" }),
  act("meeting", "Hadi — ROV autonomy discovery", "Two work-class ROVs; station-keeping in 2 kn current is the pain point. Want a demo in the Batam test tank.", -5, 14, "u-sinta", { contactIds: ["k-hadi"], companyIds: ["c-bos"], dealIds: ["d-bos-rov"] }, { durationMin: 60 }),
  act("email", "Website enquiry: smart streetlights", "Gilang submitted the contact form asking about connected streetlights for a 1,200 ha township.", -2, 9, "u-rani", { contactIds: ["k-gilang"], companyIds: ["c-mcd"], dealIds: ["d-mcd-iot"] }, { direction: "inbound" }),
  act("call", "Yanti — fire season planning", "Interested for 2027 dry season; needs grant-funded pricing. Sending case studies.", -16, 10, "u-sinta", { contactIds: ["k-yanti"], companyIds: ["c-rct"], dealIds: ["d-rct-fire"] }, { callOutcome: "connected", durationMin: 22, direction: "outbound" }),
  act("note", "Retainer renewal — usage", "Cakrawala used 186 of 200 retainer days; proposing 220 days for 2027.", -9, 16, "u-yoga", { contactIds: ["k-andre"], companyIds: ["c-cam"], dealIds: ["d-cam-renew"] }),
  act("email", "Manual rev C — torque values", "Mega flagged two conflicting torque values in section 4.3. Waiting on OEM confirmation.", -11, 10, "u-yoga", { contactIds: ["k-mega"], companyIds: ["c-cam"], ticketIds: ["t-1004"] }, { direction: "inbound" }),
  act("task", "Follow up with Ratna (APG VP Grid Ops)", "Second attempt — try via Joko's introduction.", -4, 9, "u-rani", { contactIds: ["k-ratna"], companyIds: ["c-apg"], dealIds: ["d-apg-scada"] }, { dueAt: at(-2, 17), done: true }),
];

/* procedurally add lighter-weight history to every open deal so timelines feel lived-in */
const callNotes = ["Quick check-in on timeline.", "Discussed budget approval steps.", "Walked through technical questions from their engineers.", "Confirmed decision makers and next meeting.", "Reviewed proposal assumptions."];
const emailSubjects = ["Following up on our meeting", "Case study: similar deployment", "Updated scope and assumptions", "Next steps", "Technical clarifications", "Site visit logistics"];
const generated: Activity[] = [];
deals.forEach((d) => {
  const stage = pipelines.flatMap((p) => p.stages).find((s) => s.id === d.stageId);
  const count = stage?.closed ? 2 : between(3, 5);
  for (let n = 0; n < count; n++) {
    const days = -between(5, 60);
    const contactId = d.contactIds[n % d.contactIds.length];
    const type: ActivityType = pick(["email", "email", "call", "note", "meeting"] as const);
    const links = { contactIds: [contactId], companyIds: d.companyId ? [d.companyId] : [], dealIds: [d.id] };
    const first = contacts.find((c) => c.id === contactId)?.firstName ?? "team";
    if (type === "email") generated.push(act("email", pick(emailSubjects), `Hi ${first},\n\nThanks for your time. As discussed, sharing the material and proposed next steps for ${d.name.split(" — ")[1] ?? d.name}.\n\nRegards`, days, between(8, 17), d.ownerId, links, { direction: rand() > 0.35 ? "outbound" : "inbound" }));
    else if (type === "call") generated.push(act("call", `Call with ${first}`, pick(callNotes), days, between(8, 17), d.ownerId, links, { callOutcome: pick(["connected", "connected", "connected", "no_answer", "left_voicemail"] as const), durationMin: between(4, 35), direction: "outbound" }));
    else if (type === "meeting") generated.push(act("meeting", `Working session — ${d.capability}`, "Technical deep-dive with customer engineers; actions captured in the deal record.", days, between(9, 15), d.ownerId, links, { durationMin: pick([30, 45, 60, 90]) }));
    else generated.push(act("note", "Account note", `Stakeholder map updated. ${first} is engaged; next step agreed for ${d.capability.toLowerCase()} scope.`, days, between(9, 17), d.ownerId, links));
  }
});

/* Jira activity mirrored onto CRM timelines through the cross links */
const jiraActivity: Activity[] = crossLinks
  .filter((x) => x.agileType === "issue")
  .map((x) => {
    const issue = issues.find((i) => i.id === x.agileId)!;
    const links = emptyLinks();
    if (x.crmType === "contact") links.contactIds.push(x.crmId);
    if (x.crmType === "company") links.companyIds.push(x.crmId);
    if (x.crmType === "deal") links.dealIds.push(x.crmId);
    if (x.crmType === "ticket") links.ticketIds.push(x.crmId);
    return act("jira", `${issue.key} linked (${x.linkType.replace("_", " ")})`, issue.summary, Math.round((Date.parse(x.createdAt) - SEED_NOW) / DAY), 12, x.createdById, links, { issueId: issue.id });
  });

export const activities: Activity[] = [...handwritten, ...generated, ...jiraActivity].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

/* ───────────────────────── engagement & automation (Phase 3 UI) ───────────────────────── */

export const emailTemplates: EmailTemplate[] = [
  { id: "tpl-intro", name: "Intro — deep-tech partner", subject: "{{company.name}} × Spectrum Group", body: "Hi {{contact.first_name}},\n\nSpectrum Group helps teams like {{company.name}} go from concept to certified deployment across unmanned systems, AI, sensors and control systems.\n\nWould a 20-minute call next week be useful?\n\n{{owner.first_name}}", ownerId: "u-rani", category: "Prospecting" },
  { id: "tpl-case", name: "Case study follow-up", subject: "How we cut inspection time by 60%", body: "Hi {{contact.first_name}},\n\nFollowing up with a short case study relevant to {{company.name}}'s {{deal.capability}} plans.\n\n{{owner.first_name}}", ownerId: "u-sinta", category: "Follow-up" },
  { id: "tpl-meet", name: "Meeting request", subject: "Time for a technical deep-dive?", body: "Hi {{contact.first_name}},\n\nCould our engineers walk your team through the approach? Pick a slot here: {{owner.meeting_link}}\n\n{{owner.first_name}}", ownerId: "u-arif", category: "Meeting" },
  { id: "tpl-onboard", name: "Onboarding kickoff", subject: "Kick-off: {{deal.name}}", body: "Hi {{contact.first_name}},\n\nThanks for choosing Spectrum Group. Your delivery lead will share the onboarding plan within 48 hours.\n\n{{owner.first_name}}", ownerId: "u-yoga", category: "Onboarding" },
];

export const sequences: Sequence[] = [
  {
    id: "seq-outbound",
    name: "Industrial outbound — 4 touch",
    ownerId: "u-rani",
    active: true,
    steps: [
      { id: "ss-1", order: 1, kind: "email", delayDays: 0, templateId: "tpl-intro", taskNote: "" },
      { id: "ss-2", order: 2, kind: "call", delayDays: 3, templateId: null, taskNote: "Call and reference the intro email" },
      { id: "ss-3", order: 3, kind: "email", delayDays: 4, templateId: "tpl-case", taskNote: "" },
      { id: "ss-4", order: 4, kind: "task", delayDays: 7, templateId: null, taskNote: "Connect on LinkedIn and close the loop" },
    ],
  },
  {
    id: "seq-event",
    name: "Post-event follow-up",
    ownerId: "u-sinta",
    active: true,
    steps: [
      { id: "ss-5", order: 1, kind: "email", delayDays: 1, templateId: "tpl-meet", taskNote: "" },
      { id: "ss-6", order: 2, kind: "call", delayDays: 4, templateId: null, taskNote: "Offer a site visit" },
    ],
  },
];

export const sequenceEnrollments: SequenceEnrollment[] = [
  { id: "se-1", sequenceId: "seq-outbound", contactId: "k-gilang", currentStep: 2, status: "active", enrolledAt: at(-4) },
  { id: "se-2", sequenceId: "seq-outbound", contactId: "k-tasya", currentStep: 4, status: "finished", enrolledAt: at(-30) },
  { id: "se-3", sequenceId: "seq-event", contactId: "k-bayu", currentStep: 1, status: "active", enrolledAt: at(-2) },
  { id: "se-4", sequenceId: "seq-event", contactId: "k-yanti", currentStep: 2, status: "replied", enrolledAt: at(-17) },
];

export const workflows: Workflow[] = [
  { id: "wf-1", name: "Closed-won → Onboarding epic", enabled: true, trigger: { object: "deal", event: "stage_changed", condition: "stage = Closed Won" }, actions: [{ kind: "create_epic", config: { project: "auto-by-capability", name: "{{deal.name}} Onboarding" } }, { kind: "create_issues", config: { template: "onboarding-5-tasks" } }], runs: 7, lastRunAt: at(-12) },
  { id: "wf-2", name: "Escalated bug done → resolve ticket", enabled: true, trigger: { object: "issue", event: "status_changed", condition: "status = Done AND link = escalated_from ticket" }, actions: [{ kind: "update_ticket_stage", config: { stage: "Resolved" } }, { kind: "email_contact", config: { template: "tpl-resolved" } }], runs: 12, lastRunAt: at(-16) },
  { id: "wf-3", name: "Deal blocked → notify owner", enabled: false, trigger: { object: "issue", event: "link_created", condition: "linkType = blocks AND crm = deal" }, actions: [{ kind: "notify", config: { to: "deal.owner" } }], runs: 0, lastRunAt: null },
];

/* ───────────────────────── bundle ───────────────────────── */

export const seed = {
  users,
  companies,
  contacts,
  pipelines,
  deals,
  tickets,
  products,
  lineItems,
  quotes,
  activities,
  projects,
  sprints,
  epics,
  issues,
  issueComments,
  crossLinks,
  emailTemplates,
  sequences,
  sequenceEnrollments,
  workflows,
};

export type SeedData = typeof seed;
