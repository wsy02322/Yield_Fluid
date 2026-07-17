/**
 * Independent APY audit for Fluid Lite ETH vault (iETHv2)
 * https://fluid.io/lite/1/ETH
 *
 * Does NOT trust Fluid UI / API APY fields.
 *
 * Bases (corrected):
 * - ETH base  = absolute ETH return of 1 vault share
 *               P_eth = convertToAssets(1) * Curve.get_dy(stETH -> ETH)
 * - stETH base = excess return over simply holding stETH/wstETH
 *               = vault stETH-share growth − Lido wstETH→stETH growth
 *               (this is why the two bases differ by ~staking yield)
 *
 * Fees:
 * - Exit / withdrawal fee 0.05%: ignored (per request)
 * - Performance / revenue fee 20% on profits: already embedded in
 *   convertToAssets (Net APY). We also report Gross APY by grossing up
 *   the period return: periodGross = periodNet / (1 - 0.20)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import {
  createPublicClient,
  http,
  parseAbi,
  formatEther,
  fallback,
} from "viem";
import { mainnet } from "viem/chains";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "output");

const VAULT = "0xA0D3707c569ff8C87FA923d3823eC5D81c98Be78";
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const CURVE_STETH_ETH = "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022";
const ONE = 10n ** 18n;
const WINDOWS_DAYS = [1, 7, 14, 30, 90, 120, 180];
const DAYS_PER_YEAR = 365;
const PERFORMANCE_FEE = new Decimal("0.20"); // 20% on profits, already in net exchange rate
const EXIT_FEE = new Decimal("0.0005"); // 0.05%, ignored in APY by request

const RPC_URLS = [
  process.env.ETH_RPC_URL,
  "https://eth.drpc.org",
  "https://eth-mainnet.public.blastapi.io",
  "https://gateway.tenderly.co/public/mainnet",
  "https://rpc.mevblocker.io",
  "https://eth-pokt.nodies.app",
  "https://ethereum-rpc.publicnode.com",
].filter(Boolean);

const vaultAbi = parseAbi([
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function asset() view returns (address)",
]);

const curveAbi = parseAbi([
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
]);

const wstethAbi = parseAbi([
  "function getStETHByWstETH(uint256 _wstETHAmount) view returns (uint256)",
]);

function pct(d) {
  return `${d.mul(100).toFixed(6)}%`;
}

function toDec(v) {
  return new Decimal(formatEther(v));
}

function annualize(start, end, actualDays) {
  return new Decimal(end).div(start).pow(new Decimal(DAYS_PER_YEAR).div(actualDays)).minus(1);
}

function grossUpPeriodReturn(periodNet) {
  // performance fee is charged on profits: net = gross * (1 - fee)
  return periodNet.div(new Decimal(1).minus(PERFORMANCE_FEE));
}

function annualizeFromPeriod(periodReturn, actualDays) {
  return new Decimal(1).plus(periodReturn).pow(new Decimal(DAYS_PER_YEAR).div(actualDays)).minus(1);
}

async function findBlockNearTimestamp(client, targetTs, latestBlock) {
  let lo = 1n;
  let hi = latestBlock.number;

  const approx = latestBlock.number - BigInt(
    Math.ceil((Number(latestBlock.timestamp) - targetTs) / 12) + 5000,
  );
  if (approx > 1n) lo = approx;

  let loBlock = await client.getBlock({ blockNumber: lo });
  while (Number(loBlock.timestamp) > targetTs && lo > 1n) {
    lo = lo / 2n;
    if (lo < 1n) lo = 1n;
    loBlock = await client.getBlock({ blockNumber: lo });
  }

  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) <= targetTs) lo = mid;
    else hi = mid;
  }

  const [a, b] = await Promise.all([
    client.getBlock({ blockNumber: lo }),
    client.getBlock({ blockNumber: hi }),
  ]);
  return Math.abs(Number(a.timestamp) - targetTs) <=
    Math.abs(Number(b.timestamp) - targetTs)
    ? a
    : b;
}

async function readSnapshot(client, blockNumber) {
  const [
    stethPerShareRaw,
    curveDyRaw,
    lidoWstRaw,
    totalSupplyRaw,
    totalAssetsRaw,
    block,
  ] = await Promise.all([
    client.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "convertToAssets",
      args: [ONE],
      blockNumber,
    }),
    client.readContract({
      address: CURVE_STETH_ETH,
      abi: curveAbi,
      functionName: "get_dy",
      args: [1n, 0n, ONE],
      blockNumber,
    }),
    client.readContract({
      address: WSTETH,
      abi: wstethAbi,
      functionName: "getStETHByWstETH",
      args: [ONE],
      blockNumber,
    }),
    client.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "totalSupply",
      blockNumber,
    }),
    client.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "totalAssets",
      blockNumber,
    }),
    client.getBlock({ blockNumber }),
  ]);

  const stethPerShare = toDec(stethPerShareRaw);
  const stethToEth = toDec(curveDyRaw);
  const lidoStethPerWsteth = toDec(lidoWstRaw);
  const ethPerShare = stethPerShare.mul(stethToEth);

  return {
    blockNumber: blockNumber.toString(),
    timestamp: Number(block.timestamp),
    iso: new Date(Number(block.timestamp) * 1000).toISOString(),
    stethPerShare: stethPerShare.toFixed(),
    stethToEth: stethToEth.toFixed(),
    ethPerShare: ethPerShare.toFixed(),
    lidoStethPerWsteth: lidoStethPerWsteth.toFixed(),
    totalSupply: toDec(totalSupplyRaw).toFixed(),
    totalAssetsSteth: toDec(totalAssetsRaw).toFixed(),
  };
}

function packReturn(periodNet, actualDays) {
  const periodGross = grossUpPeriodReturn(periodNet);
  const apyNet = annualizeFromPeriod(periodNet, actualDays);
  const apyGross = annualizeFromPeriod(periodGross, actualDays);
  return {
    periodReturnNet: periodNet.toFixed(),
    periodReturnNetPct: pct(periodNet),
    periodReturnGross: periodGross.toFixed(),
    periodReturnGrossPct: pct(periodGross),
    apyNet: apyNet.toFixed(),
    apyNetPct: pct(apyNet),
    apyGross: apyGross.toFixed(),
    apyGrossPct: pct(apyGross),
  };
}

function calcWindow(start, end, requestedDays) {
  const actualDays = new Decimal(end.timestamp - start.timestamp).div(86400);

  const vaultStethStart = new Decimal(start.stethPerShare);
  const vaultStethEnd = new Decimal(end.stethPerShare);
  const vaultEthStart = new Decimal(start.ethPerShare);
  const vaultEthEnd = new Decimal(end.ethPerShare);
  const lidoStart = new Decimal(start.lidoStethPerWsteth);
  const lidoEnd = new Decimal(end.lidoStethPerWsteth);

  // Absolute growth already net of 20% performance fee (in exchange rate).
  const vaultStethPeriodNet = vaultStethEnd.div(vaultStethStart).minus(1);
  const vaultEthPeriodNet = vaultEthEnd.div(vaultEthStart).minus(1);
  const lidoPeriod = lidoEnd.div(lidoStart).minus(1);

  // stETH base = excess over holding stETH/wstETH.
  const stethExcessPeriodNet = vaultStethPeriodNet.minus(lidoPeriod);

  const ethAbs = packReturn(vaultEthPeriodNet, actualDays);
  const stethExcess = packReturn(stethExcessPeriodNet, actualDays);

  return {
    requestedDays,
    actualDays: actualDays.toFixed(6),
    start,
    end,
    diagnostics: {
      vaultStethAbsApyNetPct: pct(annualize(vaultStethStart, vaultStethEnd, actualDays)),
      lidoStakingApyPct: pct(annualize(lidoStart, lidoEnd, actualDays)),
      vaultStethAbsPeriodNetPct: pct(vaultStethPeriodNet),
      lidoPeriodPct: pct(lidoPeriod),
    },
    // Primary requested bases:
    eth: {
      meaning: "Absolute ETH return of vault share (net of 20% performance fee; exit fee ignored)",
      startPrice: vaultEthStart.toFixed(),
      endPrice: vaultEthEnd.toFixed(),
      ...ethAbs,
    },
    steth: {
      meaning:
        "Excess return over holding stETH/wstETH = vault stETH growth − Lido wstETH→stETH growth (net of performance fee; exit fee ignored)",
      vaultStethStart: vaultStethStart.toFixed(),
      vaultStethEnd: vaultStethEnd.toFixed(),
      lidoStart: lidoStart.toFixed(),
      lidoEnd: lidoEnd.toFixed(),
      ...stethExcess,
    },
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Fluid Lite ETH Independent APY Audit");
  lines.push("");
  lines.push(`- Vault: \`${VAULT}\` (iETHv2)`);
  lines.push(`- Page: https://fluid.io/lite/1/ETH`);
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- End snapshot: block ${report.end.blockNumber} @ ${report.end.iso}`);
  lines.push(`- Exit fee ${EXIT_FEE.mul(100).toFixed(2)}%: **ignored**`);
  lines.push(
    `- Performance fee ${PERFORMANCE_FEE.mul(100).toFixed(0)}%: **included** (Net from exchange rate; Gross = Net period return / 0.8)`,
  );
  lines.push(`- Annualization: \`(1 + periodReturn) ** (365 / actualDays) - 1\``);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push("1. On-chain `convertToAssets(1e18)` → vault stETH per share.");
  lines.push("2. ETH mark: × Curve `get_dy(stETH→ETH)`.");
  lines.push("3. Lido baseline: `wstETH.getStETHByWstETH(1e18)` growth over the same window.");
  lines.push("4. **ETH base** = absolute ETH share-price APY.");
  lines.push("5. **stETH base** = excess over holding stETH/wstETH (vault stETH APY − Lido staking APY).");
  lines.push("6. Do not use Fluid API/UI APY (frontend can hardcode fallbacks).");
  lines.push("");
  lines.push("## Results — ETH base (absolute, after performance fee / Net)");
  lines.push("");
  lines.push("| Window (d) | Actual days | Start ETH/share | End ETH/share | Period Net | APY Net | APY Gross (before 20% fee) |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const w of report.windows) {
    lines.push(
      `| ${w.requestedDays} | ${w.actualDays} | ${w.eth.startPrice} | ${w.eth.endPrice} | ${w.eth.periodReturnNetPct} | **${w.eth.apyNetPct}** | ${w.eth.apyGrossPct} |`,
    );
  }
  lines.push("");
  lines.push("## Results — stETH base (excess over holding stETH, after performance fee / Net)");
  lines.push("");
  lines.push("| Window (d) | Actual days | Vault stETH growth | Lido staking | Excess Period Net | APY Net | APY Gross |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const w of report.windows) {
    lines.push(
      `| ${w.requestedDays} | ${w.actualDays} | ${w.diagnostics.vaultStethAbsPeriodNetPct} | ${w.diagnostics.lidoPeriodPct} | ${w.steth.periodReturnNetPct} | **${w.steth.apyNetPct}** | ${w.steth.apyGrossPct} |`,
    );
  }
  lines.push("");
  lines.push("## Why ETH vs stETH bases differ");
  lines.push("");
  lines.push(
    "Vault `convertToAssets` already embeds Lido/weETH staking plus leverage alpha (net of borrow + 20% fee). If both bases used only unit conversion (stETH vs Curve ETH), they would be nearly identical while the peg holds. The economically meaningful split is:",
  );
  lines.push("");
  lines.push("- ETH base ≈ total return versus holding ETH");
  lines.push("- stETH base ≈ extra return versus holding stETH (≈ ETH base − Lido staking)");
  lines.push("");
  lines.push("## Frontend hardcoded APY note");
  lines.push("");
  lines.push(
    "In Fluid frontend `lite` positions loader, if API APY < 1% it replaces displayed values with hardcoded `3.71%` / `2.97%`, and before `2026-05-18` it forced APY to `0`. Independent audit must ignore that UI layer.",
  );
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const client = createPublicClient({
    chain: mainnet,
    transport: fallback(
      RPC_URLS.map((url) => http(url, { timeout: 40_000, retryCount: 2 })),
      { rank: false },
    ),
  });

  const asset = await client.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "asset",
  });
  if (asset.toLowerCase() !== "0xae7ab96520de3a18e5e111b5eaab095312d7fe84") {
    throw new Error(`Unexpected vault asset: ${asset}`);
  }

  const latest = await client.getBlock();
  const end = await readSnapshot(client, latest.number);

  const windows = [];
  for (const days of WINDOWS_DAYS) {
    const targetTs = end.timestamp - days * 86400;
    const startBlock = await findBlockNearTimestamp(client, targetTs, latest);
    const start = await readSnapshot(client, startBlock.number);
    const row = calcWindow(start, end, days);
    windows.push(row);
    console.log(
      [
        `window=${days}d`,
        `actual=${row.actualDays}`,
        `ETH_net=${row.eth.apyNetPct}`,
        `ETH_gross=${row.eth.apyGrossPct}`,
        `stETH_excess_net=${row.steth.apyNetPct}`,
        `lido=${row.diagnostics.lidoStakingApyPct}`,
      ].join(" | "),
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    vault: VAULT,
    page: "https://fluid.io/lite/1/ETH",
    assumptions: {
      ignoreExitFee: true,
      exitFee: EXIT_FEE.toFixed(),
      performanceFee: PERFORMANCE_FEE.toFixed(),
      performanceFeeTreatment:
        "Net APY from convertToAssets already after 20% performance fee; Gross grosses up period net return by /0.8",
      daysPerYear: DAYS_PER_YEAR,
      ethBase: "absolute ETH share return via convertToAssets * Curve(stETH->ETH)",
      stethBase: "excess over Lido wstETH->stETH growth",
      trustFluidPublishedApy: false,
    },
    end,
    windows,
    summary: {
      ethBaseNetApy: Object.fromEntries(windows.map((w) => [String(w.requestedDays), w.eth.apyNetPct])),
      ethBaseGrossApy: Object.fromEntries(windows.map((w) => [String(w.requestedDays), w.eth.apyGrossPct])),
      stethBaseExcessNetApy: Object.fromEntries(windows.map((w) => [String(w.requestedDays), w.steth.apyNetPct])),
      stethBaseExcessGrossApy: Object.fromEntries(windows.map((w) => [String(w.requestedDays), w.steth.apyGrossPct])),
      lidoStakingApy: Object.fromEntries(windows.map((w) => [String(w.requestedDays), w.diagnostics.lidoStakingApyPct])),
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "fluid-lite-eth-apy.json");
  const mdPath = path.join(OUT_DIR, "fluid-lite-eth-apy.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log("\n=== SUMMARY ===");
  console.log("ETH base Net APY           :", report.summary.ethBaseNetApy);
  console.log("ETH base Gross APY         :", report.summary.ethBaseGrossApy);
  console.log("stETH excess Net APY       :", report.summary.stethBaseExcessNetApy);
  console.log("Lido staking APY (baseline):", report.summary.lidoStakingApy);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
