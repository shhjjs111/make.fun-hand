// Token Radar v14 — farm verdict and the ten-step plan.
//
// The verdict is policy, not prophecy: a $10,000 plan, capped at 0.017% of the protocol's TVL, earns a
// modelled 7.0% of implied value over 12 weeks, pays the all-in fee schedule below, and is compared with
// the same $10,000 in a 4% T-bill. Every field is derived from the row's TVL, chains, bucket and implied
// value; the dashboard repeats the same arithmetic and asserts the three headline fields.

import type { FarmFields } from './model.ts';

export interface FarmInput {
  name: string;
  category: string | null;
  bucket: string;
  chains: string[];
  tvl_usd: number;
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  as_of: string;
}

const DEPOSIT_USD = 10_000;
const CAP_SHARE = 0.00017;
const DROP_SHARE = 0.07;
const WEEKS = 12;
const TBILL_RATE = 0.04;
const HOURS_BASE = 3.4;
const FEE_RATE = 0.0002;
const FEE_FLAT = 0.95;
const FEE_CHAIN = 0.5;

const CATEGORY_EXTRA: Record<string, number> = {
  Lending: 0, Staking: 0, Yield: 0, RWA: 0.2, Curators: 0.2, Other: 0.2,
  DEX: 0.3, Derivatives: 0.3, 'Stablecoin & CDP': 0.4, CEX: 0.5, Bridge: 0.8,
};

/** A dollar figure a reader can scan: $6, $0.15, $2.50, $10,000. */
function usd(value: number): string {
  if (value >= 1) return `$${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
  if (value >= 0.1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(3)}`;
}

/** A compact TVL or implied value: $1.58B, $103M, $5.0M. */
export function shortUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

function primaryChain(chains: string[]): string {
  return chains.length > 0 ? chains[0]! : 'its main chain';
}

function chainList(chains: string[]): string {
  return chains.length === 0 ? 'an unnamed chain' : chains.slice(0, 3).join(', ');
}

function hoursFor(bucket: string, chains: number): number {
  return HOURS_BASE + (CATEGORY_EXTRA[bucket] ?? 0.2) + 0.25 * Math.max(0, chains - 1);
}

function feesFor(deposit: number, chains: number): number {
  return FEE_RATE * deposit + FEE_FLAT + FEE_CHAIN * Math.max(0, chains - 1);
}

/** The farm verdict and every number the detail box prints. */
export function farmVerdict(input: FarmInput): FarmFields {
  const tvl = Math.max(1, input.tvl_usd);
  const implied = Math.max(1, input.implied_value_usd);
  const effective = Math.round(Math.min(DEPOSIT_USD, CAP_SHARE * tvl));
  const drop = effective * DROP_SHARE * implied / tvl;
  const fees = feesFor(DEPOSIT_USD, input.chains.length);
  const net = drop - fees;
  const hours = hoursFor(input.bucket, input.chains.length);
  const netHour = hours > 0 ? net / hours : 0;
  const tbill = DEPOSIT_USD * TBILL_RATE * WEEKS / 52;
  const verdict = net <= 0 ? 'SKIP' : net > tbill && netHour > 25 ? 'FARM' : 'MARGINAL';
  const perTvl = implied / tvl;
  const feeBreak = fees / Math.max(1e-9, effective * perTvl);
  const oddsBreak = fees / Math.max(1e-9, effective * DROP_SHARE * Math.max(1, input.value_if_launches_usd) / tvl);
  const sensitivity: FarmFields['farm_sensitivity'] = [];
  for (const deposit of [1000, 3000, 10000, 30000]) {
    for (const share of [0.038, 0.07, 0.14, 0.28]) {
      const eff = Math.min(deposit, CAP_SHARE * tvl);
      const cellDrop = eff * share * implied / tvl;
      sensitivity.push({ deposit_usd: deposit, share_pct: share * 100, net_usd: Math.round((cellDrop - feesFor(deposit, input.chains.length)) * 100) / 100 });
    }
  }
  const gas = FEE_CHAIN * Math.max(0, input.chains.length - 1);
  return {
    farm_deposit_usd: effective,
    farm_drop_share: DROP_SHARE,
    farm_horizon_weeks: WEEKS,
    farm_drop_usd: drop,
    farm_fees_usd: fees,
    farm_net_usd: net,
    farm_hours: hours,
    farm_net_per_hour_usd: netHour,
    farm_tbill_usd: tbill,
    farm_verdict: verdict,
    farm_fee_break_even_pct: feeBreak * 100,
    farm_odds_break_even_pct: oddsBreak * 100,
    farm_exit_tvl_usd: Math.round(tvl * 0.83),
    farm_sensitivity: sensitivity,
    farm_tx_count: 10,
    farm_gas_usd: Math.round(gas * 100) / 100,
    farm_protocol_fee_usd: Math.round(FEE_RATE * DEPOSIT_USD * 100) / 100,
  };
}

// ---------------------------------------------------------------- the ten-step plan

function positionFor(input: FarmInput, deposit: number, chain: string): string {
  const name = input.name;
  const category = input.category ?? '';
  if (category === 'Prediction Market') return `Fund ${usd(deposit)} of USDC on ${name} and take two positions in markets you can price yourself.`;
  if (category === 'Insurance') return `Buy ${usd(deposit)} of cover from ${name} for a position you already hold on ${chain}; the premium is the cost.`;
  if (category === 'Payments') return `Open a ${name} balance with ${usd(deposit)} on ${chain}, route one payment a week, and keep inbound liquidity for the return leg.`;
  if (category === 'Chain') return `Bridge ${usd(deposit)} onto ${name} and deposit it in the chain's main lending or DEX app.`;
  if (category === 'Indexes') return `Mint ${usd(deposit)} of a ${name} index on ${chain} and hold it.`;
  if (category === 'Farm' || category === 'Governance Incentives') return `Stake ${usd(deposit)} in ${name}'s farm on ${chain}, then claim and restake the rewards each week.`;
  if (input.bucket === 'Lending') return `Supply ${usd(deposit)} of USDC to ${name}'s ${chain} market and borrow 30% of it against the receipt.`;
  if (input.bucket === 'Stablecoin & CDP') return `Open a ${name} vault on ${chain}, deposit ${usd(deposit * 2)} of collateral and mint ${usd(deposit * 0.6)} of its stablecoin.`;
  if (input.bucket === 'DEX') return `Provide ${usd(deposit)} of liquidity to ${name}'s deepest USDC pair on ${chain}: 60% USDC and 40% the volatile side.`;
  if (input.bucket === 'Yield') return `Deposit ${usd(deposit)} of USDC into ${name}'s largest vault on ${chain} and keep the vault shares.`;
  if (input.bucket === 'Curators') return `Deposit ${usd(deposit)} of USDC into the ${name} vault on ${chain} whose curator and fee are published.`;
  if (input.bucket === 'RWA') return `Finish ${name}'s allowlist step, then subscribe ${usd(deposit)} on ${chain} through its app.`;
  if (input.bucket === 'Staking') return `Stake ${usd(deposit)} of ${chain}'s staking asset through ${name} and keep the liquid receipt in the same wallet.`;
  if (input.bucket === 'Derivatives') return `Deposit ${usd(deposit)} of USDC as margin on ${name} and open a position no larger than 1.5x the margin.`;
  if (input.bucket === 'Bridge') return `Bridge ${usd(deposit)} of USDC onto ${chain} through ${name} and deposit it in the app that uses it.`;
  return `Deposit ${usd(deposit)} of USDC into ${name} on ${chain} and use the app's main action once a week.`;
}

function guardrailFor(input: FarmInput): string {
  if (input.bucket === 'Lending') return 'Keep the health factor above 2.0 and set a price alert at 1.6.';
  if (input.bucket === 'Stablecoin & CDP') return 'Add collateral if the ratio falls under 180%, and repay part of the minted stablecoin.';
  if (input.bucket === 'DEX') return 'Set a concentrated range 15% either side of the price and rebalance when price leaves it.';
  if (input.bucket === 'Yield') return "Read the vault's fee and withdrawal terms before committing; a lock longer than the plan defeats it.";
  if (input.bucket === 'Curators') return 'Split the deposit across two vaults if the curator runs more than one, and read the withdrawal queue.';
  if (input.bucket === 'RWA') return "Read the redemption notice period and the issuer's attestations; a position you cannot redeem is not a farm position.";
  if (input.bucket === 'Staking') return "Do not restake the receipt unless you can name its slashing and depeg risk; check the receipt's peg weekly.";
  if (input.bucket === 'Derivatives') return 'Set a stop at 20% of the margin and check funding every few days.';
  if (input.bucket === 'Bridge') return "Use the canonical bridge where one exists, and check the bridge's TVL against the amount you move.";
  return 'Write down the exit route before depositing, and test it with a 10% withdrawal first.';
}

function watchFor(input: FarmInput): string {
  if (input.bucket === 'Lending') return "Watch utilisation and borrow APR weekly; above 90% utilisation, withdrawals can queue.";
  if (input.bucket === 'Stablecoin & CDP') return "Watch the collateral price and the stablecoin's peg; a depeg below $0.97 is a reason to repay.";
  if (input.bucket === 'DEX') return "Watch impermanent loss: if the volatile side moves more than 25%, compare the LP with simply holding it.";
  if (input.bucket === 'Yield') return "Check that the vault's TVL is stable and that its strategy has not rotated into one counterparty.";
  if (input.bucket === 'Curators') return "Check the curator's fee changes and the vault's allocation monthly.";
  if (input.bucket === 'RWA') return "Track the issuer's filings and the redemption queue; RWA exits are slower than the market.";
  if (input.bucket === 'Staking') return 'Check the validator set and slashing history monthly, and keep the peg within 1% of the underlying.';
  if (input.bucket === 'Derivatives') return 'Check the oracle source and funding rate weekly; thin markets gap through stops.';
  return 'Keep the position under a tenth of the farm budget, and revisit the record monthly.';
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

function unbondingFor(bucket: string): string {
  if (bucket === 'Staking') return 'a 7 to 21 day unbonding period';
  if (bucket === 'RWA') return 'the redemption notice period, often 30 to 90 days';
  if (bucket === 'Curators') return 'the vault withdrawal queue, usually 1 to 7 days';
  if (bucket === 'Lending') return 'a same-day withdrawal, if utilisation is under 90%';
  if (bucket === 'DEX') return 'a same-day withdrawal, once the pool rebalances';
  return 'the protocol withdrawal window, usually 1 to 3 days';
}

/** One protocol's ten steps, each an action with its cost and time. */
export function farmPlan(input: FarmInput): string[] {
  const chain = primaryChain(input.chains);
  const deposit = Math.round(Math.min(DEPOSIT_USD, CAP_SHARE * input.tvl_usd));
  const gas = 0.5 * Math.max(0, input.chains.length - 1) + 0.15;
  const hold = holdDaysFor(input.age_days);
  const weeks = Math.ceil(hold / 7);
  const chunk = Math.max(10, Math.round(deposit / 10));
  const steps: string[] = [];
  steps.push(`Create a fresh wallet and keep ${usd(gas * 4)} of ${chain} gas in it; do not reuse your main wallet. Cost: ${usd(gas * 4)}. Time: 15 minutes.`);
  steps.push(`Confirm ${input.name}'s record on its own site and docs: ${shortUsd(input.tvl_usd)} TVL on ${chainList(input.chains)}, no token on ${input.as_of}; skip if a token is live or announced. Cost: $0. Time: 20 minutes.`);
  steps.push(`Move ${usd(deposit)} of USDC to ${chain} and keep ${usd(gas * 2)} of gas for approvals and the first deposit. Cost: ${usd(gas * 2)}. Time: 20 minutes.`);
  steps.push(`Read the strategy and counterparty risk, then cap the position at ${usd(deposit)}. ${guardrailFor(input)} Cost: $0. Time: 15 minutes.`);
  steps.push(`${positionFor(input, deposit, chain)} Cost: ${usd(deposit)} deposit plus ${usd(gas)} of gas. Time: 20 minutes.`);
  steps.push(`Confirm the receipt token or points eligibility in the protocol's own app and keep the receipt in the same wallet. Cost: ${usd(gas)}. Time: 10 minutes.`);
  steps.push(`Repeat one small action each week for ${weeks} weeks: swap ${usd(chunk)}, claim and restake rewards, or vote. Cost: about ${usd(gas * weeks)} in all. Time: 10 minutes a week.`);
  steps.push(`Run a weekly check for ${weeks} weeks: ${watchFor(input)} Cost: $0. Time: 5 minutes a week.`);
  steps.push(`Unwind the ${usd(deposit)} and wait out ${unbondingFor(input.bucket)}; keep ${usd(gas)} of gas for the exit. Cost: a 0.1% to 0.5% withdrawal fee plus ${usd(gas)}. Time: one withdrawal.`);
  steps.push(`Log every transaction hash, date and contract address; claim only from the address ${input.name}'s own rewards page publishes. Cost: $0. Time: 15 minutes a month.`);
  return steps.map(trimStep);
}

function trimStep(step: string): string {
  let text = step.replace(/\s+/g, ' ').trim();
  if (text.length > 600) {
    const cut = text.slice(0, 597);
    const lastSpace = cut.lastIndexOf(' ');
    text = `${cut.slice(0, lastSpace > 400 ? lastSpace : 597)}...`;
  }
  if (text.length < 20) text = `${text} Cost: $0. Time: 5 minutes.`;
  return text;
}
