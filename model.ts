// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// pre-token protocol the house's own exclusion rule leaves standing: no wrapped, staked or bridged
// product of a protocol whose token already trades. A protocol is pre-token when its index entry
// records no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols
// are kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. The multiple is not a flat house
// constant: it is what the market itself pays for TVL in this protocol's category, read off the
// snapshot's live-token protocols at run time — the median market-cap-to-TVL ratio of the live
// protocols in the category (three or more of them), else the median across all live protocols.
// A bridge's TVL is worth more than a lending pool's because the market says so, in this snapshot:
//
//   multiple   = median(mcap_usd / tvl_usd) over live protocols in the category (n >= 3),
//                else the median over all live protocols; clamped to [0.05, 1.5]
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row, and the multiples are
// recomputed from the snapshot on every run, so a different snapshot gives different multiples.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_min: number;
  multiple_max: number;
  multiple_min_n: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_min: 0.05,
  multiple_max: 1.5,
  multiple_min_n: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibrated multiple: the median mcap/TVL of its live protocols, and how many stood behind it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  n: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    multiple_source: 'category' | 'overall';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  multiple_source: 'category' | 'overall';
  growth_multiplier: number;
  maturity_multiplier: number;
  /** Whether this row is one of the snapshot's forty watchlist protocols. */
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  overall_multiple: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or null when it is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The market's own multiples, read off the snapshot: per category where three or more live protocols stand, and overall. */
export interface Multiples {
  byCategory: Map<string, { multiple: number; n: number }>;
  overall: number;
}

export function calibrateMultiples(snapshot: Snapshot, model: ModelConstants): Multiples {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const overall = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.25;
  const byCategory = new Map<string, { multiple: number; n: number }>();
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = perCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(p.category, list);
  }
  for (const [category, ratios] of perCategory) {
    if (ratios.length < model.multiple_min_n) continue;
    const m = median(ratios);
    if (m !== null) byCategory.set(category, { multiple: clampMultiple(m, model), n: ratios.length });
  }
  return { byCategory, overall: clampMultiple(overall, model) };
}

function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_max, Math.max(model.multiple_min, value));
}

/** One protocol's multiple: its category's where three or more live protocols stand behind it, else the overall median. */
export function multipleFor(category: string | null, multiples: Multiples): { multiple: number; n: number; source: 'category' | 'overall' } {
  if (category !== null) {
    const entry = multiples.byCategory.get(category);
    if (entry !== undefined) return { multiple: entry.multiple, n: entry.n, source: 'category' };
  }
  return { multiple: multiples.overall, n: 0, source: 'overall' };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Multiples,
): { implied: number; multiple: number; multipleN: number; multipleSource: 'category' | 'overall'; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, n, source } = multipleFor(protocol.category, multiples);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, multipleN: n, multipleSource: source, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The watchlist's own exclusion categories: wrapped, staked or bridged products of a traded token. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A whole word wrapped, staked or staking in the name marks a product of another protocol's token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name is the exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a protocol whose token already trades — the house watchlist's own exclusion rule,
 * applied to every row, not only the watchlist's forty.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = calibrateMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the exclusion rule leaves standing. No cap: the
  // radar exists to find them all, and a protocol below the floor is no worse a subject.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple, multipleN, multipleSource, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, implied, multiple, multipleN, multipleSource, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      multiple_n: s.multipleN,
      multiple_source: s.multipleSource,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Chains whose transactions cost about a dollar or less: layer 2s and fast low-fee chains. */
const CHEAP_CHAINS = [
  'arbitrum', 'optimism', 'base', 'zksync', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'starknet', 'zora', 'fraxtal', 'manta', 'taiko',
  'solana', 'sui', 'aptos', 'sei', 'injective', 'near', 'polygon', 'bsc', 'binance', 'avalanche', 'gnosis', 'celo', 'moonbeam', 'aurora',
  'tron', 'kava', 'cronos', 'metis', 'boba',
];

/** What one transaction costs on a chain, in whole dollars: Ethereum is dear, cheap chains are pennies, the rest sit between. */
export function gasFor(chain: string): { first: number; weekly: number } {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return { first: 12, weekly: 3 };
  if (CHEAP_CHAINS.some((cheap) => c.includes(cheap))) return { first: 1, weekly: 1 };
  return { first: 3, weekly: 1 };
}

/** A whole-dollar figure, written with commas. */
function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} and keep the position open.`;
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${n}'s main pool on ${chain} and keep the position open.`;
  if (cat.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n} and use the bridged funds in its app.`;
  if (cat.includes('staking') || cat.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} and keep the receipt.`;
  if (cat.includes('perpetual') || cat.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedge.`;
  if (cat.includes('prediction')) return `Fund $${capital} and place one market position on ${n}.`;
  if (cat.includes('curator') || cat.includes('allocator')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the shares.`;
  if (cat.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain}.`;
  if (cat.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (cat.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age, growth), never from a hand-written list of
 * names. The second step states why this protocol is worth farming, in its own figures.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const growth = p.change_7d === null ? 'unreported' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% over seven days`;
  const ageText = age === null ? 'an unlisted age' : age >= 365 ? `${(age / 365).toFixed(1)} years` : `${Math.round(age)} days`;
  const plan: [string, string, string][] = [
    [`Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, `about $${gas.first} of gas for the first transaction on ${chain}`, '5 minutes'],
    [`Check why this one: ${p.name} holds ${dollars(p.tvl_usd)} of TVL, ${growth}, and has run ${ageText} with no token on record.`, 'nothing to check', '10 minutes'],
    [action, `$${capital} of capital and about $${gas.first} of gas`, '15 minutes to set up'],
    [`Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, `about $${gas.weekly} of gas a week on ${chain}`, '10 minutes a week'],
    [`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, `the $${capital} stays in the position`, `${hold} days`],
    [`Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, 'no fee to check, and never pay to claim', '10 minutes'],
    [`Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, 'nothing but the log', '5 minutes'],
  ];
  return plan.map(([text, cost, time]) => ({ text, cost, time }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_n: row.model.multiple_n,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const multiples = calibrateMultiples(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiplesTable: CategoryMultiple[] = [...multiples.byCategory.entries()]
    .map(([category, entry]) => ({ category, multiple: entry.multiple, n: entry.n }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    overall_multiple: multiples.overall,
    multiples: multiplesTable,
    rows: board.map((r) => ({ ...radarRow(r), watchlist: snapshot.watchlist.includes(r.slug) })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
