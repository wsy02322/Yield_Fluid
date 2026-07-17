# Fluid Lite ETH Independent APY Audit

- Vault: `0xA0D3707c569ff8C87FA923d3823eC5D81c98Be78` (iETHv2)
- Page: https://fluid.io/lite/1/ETH
- Generated at: 2026-07-17T10:31:16.439Z
- End snapshot: block 25551821 @ 2026-07-17T10:30:59.000Z
- Exit fee 0.05%: **ignored**
- Performance fee 20%: **included** (Net from exchange rate; Gross = Net period return / 0.8)
- Annualization: `(1 + periodReturn) ** (365 / actualDays) - 1`

## Method

1. On-chain `convertToAssets(1e18)` → vault stETH per share.
2. ETH mark: × Curve `get_dy(stETH→ETH)`.
3. Lido baseline: `wstETH.getStETHByWstETH(1e18)` growth over the same window.
4. **ETH base** = absolute ETH share-price APY.
5. **stETH base** = excess over holding stETH/wstETH (vault stETH APY − Lido staking APY).
6. Do not use Fluid API/UI APY (frontend can hardcode fallbacks).

## Results — ETH base (absolute, after performance fee / Net)

| Window (d) | Actual days | Start ETH/share | End ETH/share | Period Net | APY Net | APY Gross (before 20% fee) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.000000 | 1.214181521414946818012206059270289412 | 1.21424950834987145788312728141198852 | 0.005599% | **2.064752%** | 2.587549% |
| 7 | 7.000000 | 1.21338711872651956041323445227114732 | 1.21424950834987145788312728141198852 | 0.071073% | **3.774105%** | 4.739250% |
| 14 | 14.000000 | 1.212676595443243150838437924702434154 | 1.21424950834987145788312728141198852 | 0.129706% | **3.437178%** | 4.314062% |
| 30 | 30.000000 | 1.21084774541415729741509647271777318 | 1.21424950834987145788312728141198852 | 0.280941% | **3.472240%** | 4.357418% |
| 90 | 90.000000 | 1.206429062035633717109251567881213502 | 1.21424950834987145788312728141198852 | 0.648231% | **2.655088%** | 3.327078% |
| 120 | 120.000000 | 1.203605430419366287276503060947752821 | 1.21424950834987145788312728141198852 | 0.884349% | **2.714254%** | 3.400459% |
| 180 | 180.000000 | 1.19861710558821896904001521846765936 | 1.21424950834987145788312728141198852 | 1.304203% | **2.662361%** | 3.333492% |

## Results — stETH base (excess over holding stETH, after performance fee / Net)

| Window (d) | Actual days | Vault stETH growth | Lido staking | Excess Period Net | APY Net | APY Gross |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.000000 | 0.008985% | 0.006033% | 0.002952% | **1.083342%** | 1.356002% |
| 7 | 7.000000 | 0.074124% | 0.042253% | 0.031872% | **1.675493%** | 2.098650% |
| 14 | 14.000000 | 0.127899% | 0.085295% | 0.042604% | **1.116705%** | 1.397750% |
| 30 | 30.000000 | 0.266635% | 0.188084% | 0.078551% | **0.959903%** | 1.201197% |
| 90 | 90.000000 | 0.639436% | 0.600065% | 0.039370% | **0.159765%** | 0.199736% |
| 120 | 120.000000 | 0.885879% | 0.801048% | 0.084831% | **0.258251%** | 0.322884% |
| 180 | 180.000000 | 1.312159% | 1.210189% | 0.101970% | **0.206881%** | 0.258635% |

## Why ETH vs stETH bases differ

Vault `convertToAssets` already embeds Lido/weETH staking plus leverage alpha (net of borrow + 20% fee). If both bases used only unit conversion (stETH vs Curve ETH), they would be nearly identical while the peg holds. The economically meaningful split is:

- ETH base ≈ total return versus holding ETH
- stETH base ≈ extra return versus holding stETH (≈ ETH base − Lido staking)

## Frontend hardcoded APY note

In Fluid frontend `lite` positions loader, if API APY < 1% it replaces displayed values with hardcoded `3.71%` / `2.97%`, and before `2026-05-18` it forced APY to `0`. Independent audit must ignore that UI layer.
