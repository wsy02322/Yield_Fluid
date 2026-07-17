# Fluid Lite ETH Independent APY Audit

- Vault: `0xA0D3707c569ff8C87FA923d3823eC5D81c98Be78` (iETHv2)
- Page: https://fluid.io/lite/1/ETH
- Generated at: 2026-07-17T10:23:56.606Z
- End snapshot: block 25551785 @ 2026-07-17T10:23:35.000Z
- Exit fee: ignored (on-chain withdrawal fee is 0.05%, not applied here)
- Annualization: `(P_end / P_start) ** (365 / actualDays) - 1`

## Method

1. On-chain `convertToAssets(1e18)` → stETH per share (ERC-4626; `asset()` = stETH).
2. Curve stETH/ETH `get_dy(1,0,1e18)` → ETH per 1 stETH market conversion.
3. ETH-per-share = stETH-per-share × Curve(stETH→ETH).
4. Do **not** use Fluid API/UI `apy.apyWithoutFee` / hardcoded frontend fallbacks.

## Results — stETH base

| Window (d) | Actual days | Start stETH/share | End stETH/share | Period return | APY |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.000000 | 1.214422443504576686 | 1.214531561690703132 | 0.008985% | **3.333814%** |
| 7 | 7.000000 | 1.213631964149786155 | 1.214531561690703132 | 0.074124% | **3.939235%** |
| 14 | 14.000000 | 1.212980172076538689 | 1.214531561690703132 | 0.127899% | **3.388525%** |
| 30 | 30.000000 | 1.211301810859702529 | 1.214531561690703132 | 0.266635% | **3.292789%** |
| 90 | 90.000000 | 1.206814755107017279 | 1.214531561690703132 | 0.639436% | **2.618713%** |
| 120 | 120.000000 | 1.203866753117106639 | 1.214531561690703132 | 0.885879% | **2.718993%** |
| 180 | 180.000000 | 1.19880138385118736 | 1.214531561690703132 | 1.312159% | **2.678710%** |

## Results — ETH base

| Window (d) | Actual days | Start ETH/share | End ETH/share | Period return | APY |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.000000 | 1.214181521414946818012206059270289412 | 1.21424950834987145788312728141198852 | 0.005599% | **2.064752%** |
| 7 | 7.000000 | 1.21338712369887585935922894130369131 | 1.21424950834987145788312728141198852 | 0.071073% | **3.774083%** |
| 14 | 14.000000 | 1.212676596127993690184879796588444571 | 1.21424950834987145788312728141198852 | 0.129706% | **3.437176%** |
| 30 | 30.000000 | 1.21084774541415729741509647271777318 | 1.21424950834987145788312728141198852 | 0.280941% | **3.472240%** |
| 90 | 90.000000 | 1.206429062035633717109251567881213502 | 1.21424950834987145788312728141198852 | 0.648231% | **2.655088%** |
| 120 | 120.000000 | 1.203605430419366287276503060947752821 | 1.21424950834987145788312728141198852 | 0.884349% | **2.714254%** |
| 180 | 180.000000 | 1.19861710558821896904001521846765936 | 1.21424950834987145788312728141198852 | 1.304203% | **2.662361%** |

## Notes

- Fluid frontend currently overrides displayed APY when API APY < 1% (hardcoded fallback), and zeroed APY before 2026-05-18 — another reason to compute independently.
- ETH base embeds Curve stETH/ETH depeg + pool fee in `get_dy`; stETH base isolates vault share growth in asset units.
