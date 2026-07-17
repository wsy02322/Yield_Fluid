# Lido Earn ETH Deposit 页面 APY 显示审计

> 审计对象：`https://stake.lido.fi/earn/eth/deposit`  
> 范围：**仅官网前端页面代码**（对比 Fluid Lite 是否存在同类“硬编码/静默改 APY”问题）  
> Widget release：`ethereum-staking-widget@0.145.2`  
> 审计时间：2026-07-17

## 1. 结论（先说）

**未发现与 Fluid Lite 同类的问题。**

| 检查项 | Fluid Lite (`fluid.io/lite/1/ETH`) | Lido Earn ETH (`stake.lido.fi/earn/eth/deposit`) |
|---|---|---|
| APY `<1%` 时硬编码成常数 | 有（`2.97` / `3.71`） | **无** |
| 按时间窗强制改 APY | 有（2026-05-18 前强制 `0`） | **无** |
| 异常时的前端行为 | 静默替换成“看起来正常”的正收益 | 加载态 / 空值；过期则 **变灰仍显示原值** |
| 主展示数字来源 | API 后被前端改写 | Mellow `timeweighted-apy` **原值展示** |

一句话：Lido 这个页面**没有**“真实很低却显示成 2.97%/3.71%”这类前端美化逻辑。

---

## 2. 页面与产品是什么

该路由不是单纯 Lido stETH 质押页，而是 **Lido Earn ETH meta-vault**（Mellow 基础设施）：

- 页面：`/earn/[vault]/[action]`，`vault=eth`, `action=deposit`
- Vault 合约映射：`ethVault = 0x6a37725ca7f4CE81c004c955f7280d5C704a249e`
- Share manager：`0xBBFC8683C8fE8cF73777feDE7ab9574935fea0A4`
- APY API：
  - `GET https://api.mellow.finance/v1/chain/1/core-vaults/{ethVault}/timeweighted-apy`
- 文档式费用披露（页面 FAQ/对比表）：
  - Management fee **1%**
  - Performance fee **10%**

Live 抽样（审计时）：

```json
{"apy":"3.52556","days":14,"apyLastUpdate":"1784280023"}
```

---

## 3. 前端证据与数据流

主要证据文件（本地副本）：

- `audit/lido-frontend-evidence/page.html`
- `audit/lido-frontend-evidence/_app-*.js`
- `audit/lido-frontend-evidence/4548-*.js`
- `audit/lido-frontend-evidence/snapshot.json`

### 3.1 APY 拉取（透传，无硬编码替换）

`_app` chunk 内 ETH vault APY loader：

```js
// 简化还原
const ethVault = getAddress(Mainnet, "ethVault");
const url = `${mellowApi}/v1/chain/${Mainnet}/core-vaults/${ethVault}/timeweighted-apy`;
const { apy, apyLastUpdate } = await fetch(url);
return { apy, apyLastUpdate };
```

公共 hook：

```js
isApyStale = (now - apyLastUpdateMs) >= 172_800_000; // 48h
return { apy, apyUpdateTimestampMs, isApyStale, isLoading };
```

### 3.2 页面展示

- 展示字段：`apx`（来自上述 API `apy`）
- 格式化：`decimals: "percent"`（百分比格式化）
- 若 `isApxStale === true`：数字 **变灰（muted）**，但**不改数值**
- 标签文案可见：`APY* (14d avg.)`（明示窗口）

这与 Fluid 的“改数字”完全不同：Lido 选择 **视觉降级 + 保留原值**。

### 3.3 关于 bundle 中出现的 `3.71` / `2.97`

在 `_app` 大包里能搜到 `3.71`/`2.97`，但上下文是 **SVG path / gradient 坐标**，不是 APY 常量。  
同时不存在 Fluid 特征码：

- 无 `apyWithoutFee` / `apyWithFee`
- 无 `.lt(1) ? "2.97"`
- 无 `Date.UTC(2026,4,18,...)` 强制清零

---

## 4. 发现的“相关但不同”点（非同类问题）

### L-01（信息）展示依赖第三方/合作方 API

页面 APY 直接展示 Mellow `timeweighted-apy`。  
这不等于“硬编码造假”，但意味着：

- 官网数字可信度取决于 Mellow API 口径与更新质量；
- 独立审计仍应另做链上份额净值复核（本报告范围外）。

### L-02（低）过期数据处理较克制

`apyLastUpdate` 超过 48 小时仅标记 stale 并降对比度，不替换成固定收益率。  
这是可接受的 UX；建议可再加 `Stale` / `Updated at` 明示。

### L-03（信息）stETH SMA APR 有失败回退，但是 API/SDK 回退

经典 stake APR 路径在 HTTP 失败时回退到 SDK `getSmaApr({days:7})`，不是写死 `2.xx%` 常量。  
与 Fluid 的常量美化不是一类问题。

---

## 5. 与 Fluid 问题的直接对比

Fluid 问题本质：

> 真实计算结果不合意时，前端静默改成另一个“好看”的数。

Lido Earn ETH 前端行为：

> 取 Mellow 时间加权 APY → 格式化展示；异常/过期时降级显示，不伪造收益率。

因此：

- **Fluid 那类“硬编码回退 APY”问题：Lido 该页未发现。**
- 若继续做收益真实性审计，应转向 **Mellow API 口径 vs 链上净值**，而不是前端改数。

## 6. 审计意见

对“有没有类似 Fluid 的前端 APY 写死问题”：

**答案：没有。**

Lido 该页在前端层面对 APY 的处理明显更克制，未观察到静默美化低 APY 的代码路径。
