/* Extra persisted + synced collections for the "engine" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot). */
import type { BonusAdjustment, CompanyTurnover, TaxRegimeChange } from "../initiatives/types";

/**
 * §5.4 Finance's monthly company gross turnover (all revenue excl. VAT, including work outside the policy) for the
 * UMKM Rp4.8bn test — entered with recordCompanyTurnover. Until Finance enters it, umkmTurnover() falls back to the
 * programme's collected payments, which is a lower bound.
 */
export const companyTurnover: CompanyTurnover[] = [];

/** §5.4 dated tax-regime switches recorded by Finance (recordTaxRegimeChange) — none yet; the company is under the UMKM final tax. */
export const taxRegimeChanges: TaxRegimeChange[] = [];

/** §8.3 reconciliation top-ups and §8.5 underpayment corrections waiting for their salary cycle. */
export const bonusAdjustments: BonusAdjustment[] = [];

export const engineSeed = { companyTurnover, taxRegimeChanges, bonusAdjustments };
