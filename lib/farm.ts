// The farm plans: for each ranked protocol, the steps a reader would actually take, with what each
// one costs and how long it takes.
//
// A plan is derived from the row, never written by hand: the category picks the position and the risk
// guard, the first chain picks the gas cost, the TVL sets the capital, and the age sets how long the
// position has to stay open. Every step is one string — the action, its cost and its time — because
// board.json's farm_steps is a list of strings, and the dashboard renders the same list.
//
// The dashboard's app.js repeats these functions so the page's detail view and board.json agree; the
// entry's tools/gate.mjs checks every row of the two against each other.

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

/** One chain's cost for a simple transaction, in whole dollars; anything unlisted pays the default. */
const CHAIN_GAS: Record<string, number> = {
  Ethereum: 6,
  Arbitrum: 0.15,
  Optimism: 0.12,
  Base: 0.12,
  'Polygon zkEVM': 0.05,
  Polygon: 0.05,
  Binance: 0.35,
  BNB: 0.35,
  Solana: 0.02,
  Avalanche: 0.25,
  Tron: 1.2,
  Bitcoin: 2.5,
  Sui: 0.05,
  Aptos: 0.05,
  'Hyperliquid L1': 0.02,
  Ink: 0.03,
  Monad: 0.03,
  Plasma: 0.05,
  Pharos: 0.05,
  Sonic: 0.05,
  Berachain: 0.08,
  Mantle: 0.05,
  Linea: 0.12,
  Scroll: 0.12,
  Blast: 0.1,
  'zkSync Era': 0.12,
  Starknet: 0.05,
  Taiko: 0.1,
  CORE: 0.05,
  Mezo: 0.05,
  'Robinhood Chain': 0.05,
  'World Chain': 0.05,
  Algorand: 0.02,
  Stellar: 0.01,
  XRP: 0.01,
  Noble: 0.02,
  Bitlayer: 0.05,
  BSquared: 0.05,
  Canto: 0.05,
  Kava: 0.05,
  Fantom: 0.05,
  Moonbeam: 0.03,
  Moonriver: 0.03,
  Harmony: 0.01,
  Cronos: 0.02,
  Gnosis: 0.02,
  xDai: 0.02,
  Astar: 0.03,
  Polkadot: 0.1,
  Kusama: 0.1,
  Flow: 0.02,
  'Babylon Genesis': 0.05,
  EOS: 0.02,
  TON: 0.05,
  Near: 0.02,
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

/** The first chain a protocol records, or a neutral phrase. */
function primaryChain(chains: string[]): string {
  return chains.length > 0 ? chains[0]! : 'its main chain';
}

/** The two or three chains a reader sees first. */
function chainList(chains: string[]): string {
  if (chains.length === 0) return 'an unnamed chain';
  return chains.slice(0, 3).join(', ');
}

/** A simple transaction's gas on a chain. */
function gasOf(chain: string): number {
  return CHAIN_GAS[chain] ?? 0.3;
}

/** The capital one position needs, from the protocol's own TVL: small protocols get small positions. */
function capitalFor(tvl: number): number {
  if (tvl < 10_000_000) return 100;
  if (tvl < 25_000_000) return 250;
  if (tvl < 50_000_000) return 500;
  if (tvl < 100_000_000) return 1_000;
  if (tvl < 250_000_000) return 2_500;
  if (tvl < 1_000_000_000) return 5_000;
  return 10_000;
}

/** How long the position has to stay open, from how long the protocol has run with no token. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The unlock or withdrawal wait a bucket normally has. */
function unbondingFor(bucket: string): string {
  if (bucket === 'Staking') return 'a 7 to 21 day unbonding period';
  if (bucket === 'RWA') return 'the redemption notice period, often 30 to 90 days';
  if (bucket === 'Curators') return 'the vault withdrawal queue, usually 1 to 7 days';
  if (bucket === 'Lending') return 'a same-day withdrawal, if utilisation is under 90%';
  if (bucket === 'DEX') return 'a same-day withdrawal, once the pool rebalances';
  return 'the protocol withdrawal window, usually 1 to 3 days';
}

/** The position step: what the reader actually does with the capital, by bucket and by category. */
function positionFor(input: FarmInput, capital: number, chain: string): string {
  const name = input.name;
  const category = input.category ?? '';
  if (category === 'Prediction Market') return `Fund ${usd(capital)} of USDC on ${name} and take two positions in markets you can price yourself; leave the rest as liquidity if the protocol pays for it.`;
  if (category === 'Insurance') return `Buy ${usd(capital)} of cover from ${name} for a position you already hold on ${chain}; the premium, not the notional, is the cost.`;
  if (category === 'Payments') return `Open a ${name} balance or channel with ${usd(capital)} on ${chain}, route one payment a week, and keep enough inbound liquidity for the return leg.`;
  if (category === 'Chain') return `Bridge ${usd(capital)} onto ${name} and deposit it in the chain's main lending or DEX app, so the activity is on ${name} itself.`;
  if (category === 'Indexes') return `Mint ${usd(capital)} of a ${name} index on ${chain} and hold it; rebalancing is the protocol's job, not yours.`;
  if (category === 'Privacy') return `Deposit ${usd(capital)} into ${name} on ${chain} and move it through one private action a week, keeping a record of every step.`;
  if (category === 'Farm' || category === 'Governance Incentives') return `Stake ${usd(capital)} in ${name}'s farm on ${chain}, then claim and restake the rewards each week.`;
  if (category === 'Launchpad') return `Hold ${usd(capital)} ready in a ${name} account on ${chain} and join one launch a month rather than every launch.`;
  if (input.bucket === 'Lending') return `Supply ${usd(capital)} of USDC to ${name}'s ${chain} market and borrow 30% of it against the receipt if you want the extra exposure.`;
  if (input.bucket === 'Stablecoin & CDP') return `Open a ${name} vault on ${chain}, deposit ${usd(capital * 2)} of collateral and mint ${usd(capital * 0.6)} of its stablecoin against it, keeping the ratio above 200%.`;
  if (input.bucket === 'DEX') return `Provide ${usd(capital)} of liquidity to ${name}'s deepest USDC pair on ${chain}: 60% USDC and 40% the volatile side, then stake the LP receipt if the protocol allows it.`;
  if (input.bucket === 'Yield') return `Deposit ${usd(capital)} of USDC into ${name}'s largest vault on ${chain} and keep the vault shares in the farming wallet.`;
  if (input.bucket === 'Curators') return `Deposit ${usd(capital)} of USDC into the ${name} vault on ${chain} whose curator, fee and allocation are published, and keep the shares.`;
  if (input.bucket === 'RWA') return `Finish ${name}'s allowlist or KYC step, then subscribe ${usd(capital)} on ${chain} through its app; the subscription window sets the timing, not you.`;
  if (input.bucket === 'Staking') return `Stake ${usd(capital)} of ${chain}'s staking asset through ${name} and keep the liquid receipt token it returns in the same wallet.`;
  if (input.bucket === 'Derivatives') return `Deposit ${usd(capital)} of USDC as margin on ${name} and open a position no larger than 1.5x the margin; use the vault side if the protocol offers one.`;
  if (input.bucket === 'Bridge') return `Bridge ${usd(capital)} of USDC onto ${chain} through ${name} and deposit the bridged funds in the app that uses it.`;
  return `Deposit ${usd(capital)} of USDC into ${name} on ${chain} and use the app's main action once a week.`;
}

/** The second step: the parameter that keeps the first position from being liquidated or locked. */
function guardrailFor(input: FarmInput, hold: number): string {
  const name = input.name;
  if (input.bucket === 'Lending') return `Keep the health factor above 2.0 and set a price alert at 1.6; a liquidation costs more than any likely launch reward.`;
  if (input.bucket === 'Stablecoin & CDP') return `Add collateral if the ratio falls under 180%, and repay part of the minted stablecoin instead of selling it into a thin market.`;
  if (input.bucket === 'DEX') return `If the pool is a concentrated range, set it to 15% either side of the price and rebalance when price leaves; a full range earns less and needs no attention.`;
  if (input.bucket === 'Yield') return `Read the vault's fee and its withdrawal terms first; a lock longer than ${hold} days defeats the plan.`;
  if (input.bucket === 'Curators') return `Split the deposit across two ${name} vaults if it runs more than one, and read the curator fee and the withdrawal queue before you commit.`;
  if (input.bucket === 'RWA') return `Read the redemption notice period and the issuer's attestations; a position you cannot redeem inside ${hold} days is not a farm position.`;
  if (input.bucket === 'Staking') return `Do not restake the receipt into a second protocol unless you can name its slashing and depeg risk; check the receipt's peg weekly.`;
  if (input.bucket === 'Derivatives') return `Set a stop at 20% of the margin and check funding every few days; margin that is liquidated earns nothing.`;
  if (input.bucket === 'Bridge') return `Use the canonical bridge where one exists, and check the bridge's TVL against the amount you move.`;
  return `Write down the exit route before you deposit, and test it with a withdrawal of 10% first.`;
}

/** The last step: what to watch while the position is open, by bucket. */
function riskFor(input: FarmInput): string {
  const name = input.name;
  if (input.bucket === 'Lending') return `Watch ${name}'s utilisation and borrow APR weekly; above 90% utilisation, withdrawals can queue.`;
  if (input.bucket === 'Stablecoin & CDP') return `Watch the collateral price and the stablecoin's peg; a depeg below $0.97 is a reason to repay.`;
  if (input.bucket === 'DEX') return `Watch impermanent loss: if the volatile side moves more than 25%, compare the LP's value with simply holding it.`;
  if (input.bucket === 'Yield') return `Check that the vault's TVL is stable and that its strategy has not rotated into a single counterparty.`;
  if (input.bucket === 'Curators') return `Check the curator's fee changes and the vault's allocation monthly; a sudden strategy change is a reason to leave.`;
  if (input.bucket === 'RWA') return `Track the issuer's filings and the redemption queue; RWA exits are slower than the market.`;
  if (input.bucket === 'Staking') return `Check the validator set and the slashing history monthly, and keep the receipt's peg within 1% of the underlying.`;
  if (input.bucket === 'Derivatives') return `Check the oracle source and the funding rate weekly; thin markets gap through stops.`;
  return `Keep the position under a tenth of the farm budget, and revisit the record monthly.`;
}

/** The plan in one line for the detail drawer, and the short tag the board's Plan column shows. */
export function farmBudget(input: FarmInput, steps: number): { budget: string; tag: string } {
  const capital = capitalFor(input.tvl_usd);
  const gas = gasOf(primaryChain(input.chains)) * 6;
  const weeks = Math.ceil(holdDaysFor(input.age_days) / 7);
  return {
    budget: `Capital ${usd(capital)} · gas ${usd(gas)} · ${weeks} weeks · ${steps} steps`,
    tag: `${steps} · ${capital < 1000 ? usd(capital) : `$${Math.round(capital / 1000)}k`}`,
  };
}

/**
 * One protocol's plan: nine steps, each an action with its cost and its time. The same function is
 * written into board.json and repeated in the dashboard, so the page's plan is the board's plan.
 */
export function farmPlan(input: FarmInput): string[] {
  const chain = primaryChain(input.chains);
  const gas = gasOf(chain);
  const capital = capitalFor(input.tvl_usd);
  const hold = holdDaysFor(input.age_days);
  const weeks = Math.ceil(hold / 7);
  const chunk = Math.max(10, Math.round(capital / 10));
  const steps: string[] = [];

  steps.push(
    `Confirm the record: DefiLlama counts ${shortUsd(input.tvl_usd)} of TVL on ${chainList(input.chains)} with no token on ${input.as_of}. Open ${input.name}'s own site, docs and stats page, and skip this row if a token is already live or announced. Cost: $0. Time: 15 minutes.`,
  );
  steps.push(
    `Fund a fresh wallet with ${usd(capital)} of USDC and about ${usd(gas * 6)} of ${chain} gas for six transactions, and keep the wallet clear of your main holdings. Cost: ${usd(capital)} plus ${usd(gas * 6)} of gas. Time: 20 minutes.`,
  );
  steps.push(`${positionFor(input, capital, chain)} Cost: ${usd(capital)} plus ${usd(gas)} of gas. Time: 20 minutes to set up.`);
  steps.push(`${guardrailFor(input, hold)} Cost: about ${usd(gas * 2)} of gas. Time: 10 minutes.`);
  steps.push(
    `Repeat one small action each week for ${weeks} weeks: swap ${usd(chunk)} between the receipt and USDC, claim and restake rewards, or vote if the protocol publishes a Snapshot space. Cost: about ${usd(gas * weeks)} of gas in all. Time: 10 minutes a week.`,
  );
  steps.push(
    `Keep the position open for at least ${hold} days so it appears in ${weeks} weekly records, and do not move it between wallets inside that window. Cost: the ${usd(capital)} stays at work. Time: ${hold} days.`,
  );
  steps.push(
    `Log every transaction hash, date and contract address, and check ${input.name}'s own rewards page once a month; claim only from the address it publishes. Cost: $0, and never pay to claim. Time: 15 minutes a month.`,
  );
  steps.push(
    `Unwind the ${usd(capital)} and wait out ${unbondingFor(input.bucket)}. Keep ${usd(gas)} of gas for the exit, and leave receipt tokens in the protocol rather than a third-party vault. Cost: a 0.1 to 0.5% withdrawal fee plus ${usd(gas)} of gas. Time: one withdrawal.`,
  );
  steps.push(`${riskFor(input)} Cost: $0. Time: 5 minutes a month.`);

  return steps.map(trimStep);
}

/** A step is one string within the gate's 20 to 600 characters, and nothing is ever cut mid-word. */
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
