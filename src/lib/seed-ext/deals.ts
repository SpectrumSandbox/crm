/* Extra persisted + synced collections for the "deals" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot). */
import type { DealChange, QuoteSettings } from "../types";

const DAY = 86_400_000;
/** ISO timestamp `days` from now at `hour`:00 WIB */
const at = (days: number, hour = 10) => {
  const wibMidnight = Math.floor((Date.now() + 7 * 3_600_000) / DAY) * DAY - 7 * 3_600_000;
  return new Date(wibMidnight + days * DAY + hour * 3_600_000).toISOString();
};
const closeAt = (days: number) => at(days, 17);
const M = 1_000_000;

/** A few realistic pipeline changes so "What changed" and the history card have something to show on a fresh workspace. */
const dealHistory: DealChange[] = [
  { id: "dh-1", dealId: "d-nhs-asv", field: "amount", from: 7_900 * M, to: 8_400 * M, at: at(-5, 14), byId: "u-sinta" },
  { id: "dh-2", dealId: "d-nhs-asv", field: "stageId", from: "st-proposal", to: "st-negotiation", at: at(-6, 11), byId: "u-sinta" },
  { id: "dh-3", dealId: "d-twu-nrw", field: "closeDate", from: closeAt(-12), to: closeAt(2), at: at(-20, 9), byId: "u-arif" },
  { id: "dh-4", dealId: "d-twu-nrw", field: "closeDate", from: closeAt(2), to: closeAt(9), at: at(-3, 16), byId: "u-arif" },
  { id: "dh-5", dealId: "d-ptt-insp", field: "stageId", from: "st-solution", to: "st-proposal", at: at(-4, 11), byId: "u-sinta" },
  { id: "dh-6", dealId: "d-ptt-insp", field: "amount", from: 6_500 * M, to: 7_200 * M, at: at(-4, 15), byId: "u-sinta" },
  { id: "dh-7", dealId: "d-bap-crop", field: "closeDate", from: closeAt(5), to: closeAt(14), at: at(-2, 13), byId: "u-arif" },
  { id: "dh-8", dealId: "d-apg-scada", field: "amount", from: 12_800 * M, to: 11_500 * M, at: at(-9, 10), byId: "u-rani" },
  { id: "dh-9", dealId: "d-sbs-pdm", field: "stageId", from: "st-negotiation", to: "st-won", at: at(-12, 11), byId: "u-arif" },
  { id: "dh-10", dealId: "d-mge-sensor", field: "closeDate", from: closeAt(10), to: closeAt(21), at: at(-6, 10), byId: "u-arif" },
];

const quoteSettings: QuoteSettings[] = [
  {
    id: "qs-default",
    financeCheckRequired: true,
    directorDiscountPct: 10,
    directorTotalIdr: 5_000 * M,
    defaultValidityDays: 30,
    supplierLegalName: "Spectrum Group",
    supplierNpwp: "",
    supplierAddress: "",
    supplierBank: "",
    supplierPkp: true,
    umkmFinalTax: true,
  },
];

export const dealsSeed = { dealHistory, quoteSettings };
