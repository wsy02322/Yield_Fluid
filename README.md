# Yield_Fluid

Independent on-chain APY audit utilities for Fluid / Instadapp Lite.

## Fluid Lite ETH (`iETHv2`)

Target page: https://fluid.io/lite/1/ETH

Vault: `0xA0D3707c569ff8C87FA923d3823eC5D81c98Be78`

### Method

This repo does **not** trust Fluid UI / API published APY values.

1. Read ERC-4626 `convertToAssets(1e18)` at window start/end → **stETH per share**
2. Mark to ETH with Curve stETH/ETH `get_dy(1,0,1e18)` → **ETH per share**
3. Annualize:
   `APY = (P_end / P_start) ** (365 / actualDays) - 1`
4. Exit fee (`0.05%`) is ignored by request

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
