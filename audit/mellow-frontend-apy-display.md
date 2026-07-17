# Mellow 网站前端 APY 显示审计

> 审计对象：`https://app.mellow.finance/`（Core Vaults / Restaking UI）及可访问的官方周边前端  
> 范围：对比 Fluid Lite，检查是否存在「APY 过低时静默改数 / 硬编码美化」类人为更改  
> 审计时间：2026-07-17  
> 主证据包：Wayback `2026-07-11` 抓取的 `main.f7c62d3a.js`（live app 在本环境被 Cloudflare 403）

## 1. 结论（先说）

**未发现与 Fluid Lite 同类的问题：没有「真实 APY &lt; 1% 时静默改成 2.97%/3.71%」或「按时间窗强制改成 0」这类逻辑。**

但 Mellow app **确实存在少量人为设定的展示数字**，性质不同：

| 检查项 | Fluid Lite | Mellow app（Wayback 2026-07-11 bundle） |
|---|---|---|
| APY `&lt;1%` 时硬编码成常数 | 有（`2.97` / `3.71`） | **无** |
| 按时间窗强制改 APY | 有（强制 `0`） | **无** |
| 主路径展示来源 | API 后被前端改写 | 官方 API `apy`/`apr` **原值**（可含 &lt;1%、0、负数） |
| 人为写死数字 | 伪装成实时 APY | 仅少数 **已归档 Mezo vault** 的 `predictedApy`（35/37） |
| 覆盖机制 | 全局静默 | 代码里有 `apyOverrides` 能力，但列表页当前调用 **未传入** |

一句话：Mellow **不像 Fluid 那样把低 APY 美化成“看起来正常”的收益**；EarnETH 走 API 原值。真正要留意的是少数归档 vault 的 **predicted APY（预测/宣传值）**。

### 访问限制（重要）

- 本环境请求 `https://app.mellow.finance/*` 一律 **HTTP 403**，返回旧 UniV3 “restricted” shell，**拿不到 live SPA JS**。
- 因此主审计依赖 Internet Archive：
  - HTML：`web/20260711094324id_/https://app.mellow.finance/`
  - JS：`/static/js/main.f7c62d3a.js`（sha256 `bee8fc17…c2e580`，解压后约 4.0MB）
- 该快照距审计日约 6 天，足以代表近期线上逻辑；**不能 100% 证明审计当日 live 未再热更新**。

---

## 2. 数据流（Core Vaults）

API base：`https://api.mellow.finance`

常见来源：

1. 列表：`GET /v1/vaults` → 字段 `apy` / `apr` / `apr_breakdown`
2. Core vault 详情扩展：`GET /v1/chain/{chainId}/core-vaults/{vault}/data?extended=true` → `apy`, `apyLastUpdate`, `historicalApy`
3. 时间加权：`GET /v1/chain/{chainId}/core-vaults/{vault}/timeweighted-apy`（Lido Earn 等集成方也在用）

前端选择函数 `B0(prefer, vaultData)`：

- prefer=`APY`：优先 `vaultData.apy`，否则 `apr`
- prefer=`APR`：优先 `apr`，否则 `apy`
- 两边都没有 → `null`（不是伪造正收益）

Vault 详情展示优先级（简化）：

```text
if vault.apyLoader:
    use apyLoader(address, predictedApy)
else if vault.predictedApy:
    use predictedApy          # 人为写死
else if API vault row exists:
    use B0("APY", apiRow)     # API 原值
else:
    { value: 0, type: "APY" } # 缺数据时显示 0，不是 2.97
```

列表映射里若存在 `apyOverrides[vaultAddress]`，会 **覆盖** API 值；但 `/vaults` 页实际调用是：

```js
ace({ vaults, vaultsData, vaultsCollectorData, tokensData })
// 未传 apyOverrides → 默认 {}
```

因此列表页当前 **没有启用** 覆盖表。

---

## 3. EarnETH（重点对照产品）

配置内嵌于 bundle：

- id: `earn-eth`
- address: `0x6a37725ca7f4CE81c004c955f7280d5C704a249e`
- **无** `predictedApy`
- **无** Fluid 式 floor

特殊 loader（`earn-eth` / `earn-usd`）：

```js
apy.value = data.apy ? +data.apy : 0
apy.lastUpdate = data.apyLastUpdate || ""
```

即：直接吃 `/data?extended=true` 的 API 数字；缺省为 `0`，**不会抬到固定正收益**。

API 旁证（审计时）：

- 当前 `apy ≈ 3.03841`
- `historicalApy` 含 **`0.25447`**（&lt;1%），也有 `1.27` / `2.47` 等
- **没有任何点被抬成 2.97 / 3.71**

这与此前 Lido Earn ETH 页面审计一致：Lido 也是透传 Mellow `timeweighted-apy`，过期只变灰不改数。

---

## 4. 确实存在的“人为数字”

### 4.1 `predictedApy`（归档 Mezo vault）

Bundle 内写死 3 处：

| Vault | predictedApy | 状态 |
|---|---|---|
| Mezo BTC Vault | **35% APY** | `archived: true`, `deposit.disabled: true` |
| Mezo cbBTC Vault | **35% APY** | 同上 + withdrawal lock 文案 |
| Mezo Stable Vault (`msvUSD`) | **37% APY** | 同上 |

含义：

- 这是前端配置里的 **预测/宣传 APY**，不是把实时 API 低值偷偷替换。
- 仅作用于上述 vault；且 UI 优先级里名字就叫 `predictedApy`。
- 对独立审计仍算 **人为展示数字**，但不能等同 Fluid 的全局静默美化。

### 4.2 `apyOverrides` 机制

- 代码支持按 vault address 覆盖列表 APY。
- 当前主列表调用未传入覆盖对象 → **未见启用**。
- 属于“可改数能力”，不是已观察到的全站改数行为。

---

## 5. API 本身有没有 floor？

抽样 `GET /v1/vaults`（审计时）：

- 有 `apy` 的条目中可见：**负数**（如约 `-4.78`）、**0**、以及 **&lt;1%**
- 最小值约 `-4.78`，最大值约 `30.0`
- EarnETH 历史点最低约 `0.25447`

结论：**公开 API 不会把低 APY 抬成固定正数**；前端主路径也未做 Fluid 式 floor。

---

## 6. 其他可访问表面

| 表面 | 结果 |
|---|---|
| `https://mellow.finance/` 营销站 JS `app-d9adiFJp.js` | Three.js / 落地页；**无** vault APY 硬编码改写 |
| `https://points.mellow.finance/` | 返回的是 API handler 目录 JSON，不是用户 APY UI |
| GitHub `mellow-finance/*` | 有合约/CLI/docs，**无** 公开 app 前端仓库 |
| Lido Earn ETH（Mellow 集成） | 另见 `audit/lido-frontend-apy-display.md`：无 Fluid 式改数 |

---

## 7. 证据文件

- `audit/mellow-frontend-evidence/snapshot.json`
- `audit/mellow-frontend-evidence/app-wayback-20260711.html`
- `audit/mellow-frontend-evidence/main.f7c62d3a.js.sha256.txt`
- `audit/mellow-frontend-evidence/js-excerpts.md` / `snippets.json`
- `audit/mellow-frontend-evidence/earneth-apy-historical.json`
- `audit/mellow-frontend-evidence/vaults-apy-snapshot.json`
- `audit/mellow-frontend-evidence/mellow-finance-marketing-app-d9adiFJp.js.sha256.txt`

完整 JS 体积约 4MB，未入库；可用 Wayback URL + sha256 复验。

---

## 8. 总结

1. **没有** Fluid 那种「APY&lt;1% → 硬改 2.97/3.71」或「时间窗强制 0」的前端改数。
2. EarnETH / 普通 Core Vault 主路径展示 **API 原值**（允许很低甚至为负）。
3. **有** 少量归档 Mezo vault 的 `predictedApy`（35/37）人为展示；属预测值，不是实时收益美化。
4. live `app.mellow.finance` 在本环境不可下载；结论建立在 **2026-07-11 Wayback bundle + 实时 API** 上。
