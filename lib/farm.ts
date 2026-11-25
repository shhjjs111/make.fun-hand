// The farm generator lives in dashboard/plan.js so the page's plan and board.json's plan are one
// implementation. This file is the Node-side import path; it re-exports that browser-safe module.
export {
  CHAIN_GAS,
  capitalFor,
  farmBudget,
  farmPlan,
  guardrailFor,
  holdDaysFor,
  positionFor,
  riskFor,
  shortUsd,
} from '../dashboard/plan.js';

/** What a farm plan is built from: the row's own record and the model's result. */
export interface FarmInput {
  name: string;
  category: string | null;
  bucket: string;
  chains: string[];
  tvl_usd: number;
  age_days: number | null;
  rank: number;
  implied_value_usd: number;
  as_of: string;
  watchlist: boolean;
}
