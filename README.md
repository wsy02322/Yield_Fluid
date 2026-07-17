# Yield_Fluid

Independent on-chain APY audit utilities for Fluid / Instadapp Lite.

## Fluid Lite ETH (`iETHv2`)

Target page: https://fluid.io/lite/1/ETH

Vault: `0xA0D3707c569ff8C87FA923d3823eC5D81c98Be78`

### Method

This repo does **not** trust Fluid UI / API published APY values.

1. Read ERC-4626 `convertToAssets(1e18)` at window start/end
2. **ETH base (absolute)**: `convertToAssets × Curve(stETH→ETH)`
3. **stETH base (excess over holding stETH)**: vault stETH growth − Lido `wstETH→stETH` growth
4. Annualize:
   `APY = (1 + periodReturn) ** (365 / actualDays) - 1`
5. Fees:
   - Exit fee `0.05%`: ignored
   - Performance fee `20%`: already in Net exchange-rate APY; Gross = Net period return / `0.8`

Windows: `1, 7, 14, 30, 90, 120, 180` days.

### Setup

```bash
npm install
```

Optional archive/mainnet RPC override:

```bash
export ETH_RPC_URL=https://your-archive-rpc
```

### Run

```bash
npm run calc:apy
```

Outputs:

- `output/fluid-lite-eth-apy.json`
- `output/fluid-lite-eth-apy.md`

## Frontend APY display audit (official page code only)

See `audit/frontend-apy-display.md`.

Evidence snapshots:

- `audit/frontend-evidence/K22JU5R.lite-positions.js`
- `audit/frontend-evidence/EHJheCuG.lite-eth-page.js`
- `audit/frontend-evidence/snapshot.json`
