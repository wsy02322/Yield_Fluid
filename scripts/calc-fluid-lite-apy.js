/**
 * Independent APY audit for Fluid Lite ETH vault (iETHv2)
 * https://fluid.io/lite/1/ETH
 *
 * Methodology (does NOT trust Fluid UI / API APY fields):
 * 1) Read on-chain ERC-4626 convertToAssets(1 share) at window endpoints.
 *    asset() = stETH, so this is stETH redeemable per iETHv2 share.
 * 2) Mark stETH to ETH with Curve stETH/ETH pool get_dy(stETH -> ETH).
 * 3) Annualize: APY = (P_end / P_start) ** (365 / days) - 1
 * 4) Ignore the 0.05% withdrawal fee (per request).
 *
 * Outputs two bases: stETH and ETH.
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
const CURVE_STETH_ETH = "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022";
const ONE = 10n ** 18n;
const WINDOWS_DAYS = [1, 7, 14, 30, 90, 120, 180];
const DAYS_PER_YEAR = 365;

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

function pct(d) {
  return `${d.mul(100).toFixed(6)}%`;
}

function toDec(v) {
  return new Decimal(formatEther(v));
}

async function findBlockNearTimestamp(client, targetTs, latestBlock) {
  let lo = 1n;
  let hi = latestBlock.number;

  // Fast lower bound estimate (~12s blocks) then binary search.
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
  const pick =
    Math.abs(Number(a.timestamp) - targetTs) <=
    Math.abs(Number(b.timestamp) - targetTs)
      ? a
      : b;
  return pick;
}

async function readSnapshot(client, blockNumber) {
  const [stethPerShareRaw, curveDyRaw, totalSupplyRaw, totalAssetsRaw, block] =
    await Promise.all([
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
        args: [1n, 0n, ONE], // sell 1 stETH for ETH
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
  const ethPerShare = stethPerShare.mul(stethToEth);

  return {
    blockNumber: blockNumber.toString(),
    timestamp: Number(block.timestamp),
    iso: new Date(Number(block.timestamp) * 1000).toISOString(),
    stethPerShare: stethPerShare.toFixed(),
    stethToEth: stethToEth.toFixed(),
    ethPerShare: ethPerShare.toFixed(),
    totalSupply: toDec(totalSupplyRaw).toFixed(),
    totalAssetsSteth: toDec(totalAssetsRaw).toFixed(),
  };
}

function calcWindowApy(start, end, requestedDays) {
  const actualDays = new Decimal(end.timestamp - start.timestamp).div(86400);
  const stethStart = new Decimal(start.stethPerShare);
  const stethEnd = new Decimal(end.stethPerShare);
  const ethStart = new Decimal(start.ethPerShare);
  const ethEnd = new Decimal(end.ethPerShare);

  const stethPeriod = stethEnd.div(stethStart).minus(1);
  const ethPeriod = ethEnd.div(ethStart).minus(1);

  const stethApy = stethEnd.div(stethStart).pow(new Decimal(DAYS_PER_YEAR).div(actualDays)).minus(1);
  const ethApy = ethEnd.div(ethStart).pow(new Decimal(DAYS_PER_YEAR).div(actualDays)).minus(1);

  return {
    requestedDays,
    actualDays: actualDays.toFixed(6),
    start,
    end,
    steth: {
      startPrice: stethStart.toFixed(),
      endPrice: stethEnd.toFixed(),
      periodReturn: stethPeriod.toFixed(),
      periodReturnPct: pct(stethPeriod),
      apy: stethApy.toFixed(),
      apyPct: pct(stethApy),
    },
    eth: {
      startPrice: ethStart.toFixed(),
      endPrice: ethEnd.toFixed(),
      periodReturn: ethPeriod.toFixed(),
      periodReturnPct: pct(ethPeriod),
      apy: ethApy.toFixed(),
      apyPct: pct(ethApy),
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
  lines.push(`- Exit fee: ignored (on-chain withdrawal fee is 0.05%, not applied here)`);
  lines.push(`- Annualization: \`(P_end / P_start) ** (365 / actualDays) - 1\``);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push("1. On-chain `convertToAssets(1e18)` → stETH per share (ERC-4626; `asset()` = stETH).");
  lines.push("2. Curve stETH/ETH `get_dy(1,0,1e18)` → ETH per 1 stETH market conversion.");
  lines.push("3. ETH-per-share = stETH-per-share × Curve(stETH→ETH).");
  lines.push("4. Do **not** use Fluid API/UI `apy.apyWithoutFee` / hardcoded frontend fallbacks.");
  lines.push("");
  lines.push("## Results — stETH base");
  lines.push("");
  lines.push("| Window (d) | Actual days | Start stETH/share | End stETH/share | Period return | APY |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const w of report.windows) {
    lines.push(
      `| ${w.requestedDays} | ${w.actualDays} | ${w.steth.startPrice} | ${w.steth.endPrice} | ${w.steth.periodReturnPct} | **${w.steth.apyPct}** |`,
    );
  }
  lines.push("");
  lines.push("## Results — ETH base");
  lines.push("");
  lines.push("| Window (d) | Actual days | Start ETH/share | End ETH/share | Period return | APY |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const w of report.windows) {
    lines.push(
      `| ${w.requestedDays} | ${w.actualDays} | ${w.eth.startPrice} | ${w.eth.endPrice} | ${w.eth.periodReturnPct} | **${w.eth.apyPct}** |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Fluid frontend currently overrides displayed APY when API APY < 1% (hardcoded fallback), and zeroed APY before 2026-05-18 — another reason to compute independently.");
  lines.push("- ETH base embeds Curve stETH/ETH depeg + pool fee in `get_dy`; stETH base isolates vault share growth in asset units.");
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
    const row = calcWindowApy(start, end, days);
    windows.push(row);
    console.log(
      [
        `window=${days}d`,
        `actual=${row.actualDays}`,
        `stETH_APY=${row.steth.apyPct}`,
        `ETH_APY=${row.eth.apyPct}`,
        `startBlock=${start.blockNumber}`,
        `start=${start.iso}`,
      ].join(" | "),
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    vault: VAULT,
    page: "https://fluid.io/lite/1/ETH",
    assumptions: {
      ignoreExitFee: true,
      daysPerYear: DAYS_PER_YEAR,
      stethSource: "ERC-4626 convertToAssets",
      ethMarkToMarket: "Curve stETH/ETH get_dy(stETH->ETH)",
      trustFluidPublishedApy: false,
    },
    end,
    windows,
    summary: {
      stethBase: Object.fromEntries(
        windows.map((w) => [String(w.requestedDays), w.steth.apyPct]),
      ),
      ethBase: Object.fromEntries(
        windows.map((w) => [String(w.requestedDays), w.eth.apyPct]),
      ),
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "fluid-lite-eth-apy.json");
  const mdPath = path.join(OUT_DIR, "fluid-lite-eth-apy.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log("\n=== SUMMARY (ignore exit fee) ===");
  console.log("stETH base APY:", report.summary.stethBase);
  console.log("ETH base APY  :", report.summary.ethBase);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
