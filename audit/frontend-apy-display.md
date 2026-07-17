# Fluid Lite ETH 官网页面 APY 显示审计

> 范围：**仅审计官网前端页面代码**（`https://fluid.io/lite/1/ETH`），不审计链上收益、不采信 API 业务口径本身是否正确。  
> 构建标识：`SENTRY_RELEASE = 62922be11b2a22e0c53e5bbaac03d05625bdfbcb`

## 1. 审计对象与证据

| 角色 | 资源 | 说明 |
|---|---|---|
| 页面 | `https://fluid.io/lite/1/ETH` | Lite ETH vault 弹层/详情 |
| APY 数据加载与改写 | `/_nuxt/-K22JU5R.js` | `lite-positions` 查询；拉取后改写 `apy` |
| APY 渲染 | `/_nuxt/EHJheCuG.js` | `LiteSupplyModal` 主 APY 与对比条 |
| 本地证据 | `audit/frontend-evidence/` | 抓取时的 JS 副本 + `snapshot.json` |

数据流：

```text
API /v2/mainnet/lite/users/{addr}/vaults
        │
        ▼
/_nuxt/-K22JU5R.js   ← 可能改写 apyWithFee / apyWithoutFee
        │
        ▼
/_nuxt/EHJheCuG.js   ← 页面只展示 apyWithoutFee
```

## 2. 发现 F-01（高）：前端在 APY 过低时硬编码替换展示值

### 位置

`/_nuxt/-K22JU5R.js`，函数 `w()`（positions loader）在拿到 API 结果后，对 `version === "2"` 的 vault **原地改写**：

```js
a.apy.apyWithFee =
  new d(a.apy.apyWithFee).lt(1) || new d(a.apy.apyWithoutFee).lt(1)
    ? "3.71"
    : a.apy.apyWithFee;

a.apy.apyWithoutFee =
  new d(a.apy.apyWithoutFee).lt(1)
    ? "2.97"
    : a.apy.apyWithoutFee;
```

### 含义

- 当 `apyWithoutFee < 1`（或 `apyWithFee < 1`）时：
  - 页面使用的 `apyWithoutFee` 被改成 **`"2.97"`**
  - `apyWithFee` 被改成 **`"3.71"`**
- 这不是格式化，也不是缓存，是**用常量覆盖真实 API 数值**。
- 之后所有依赖 `s.vault.apy.apyWithoutFee` 的 UI，都会显示被替换后的值。

### 影响

若后端真实 Net APY 为 `0.4%`，官网仍可能显示约 **2.97%**，用户无法从页面看出真实低收益状态。

## 3. 发现 F-02（高）：前端曾按时间窗强制把 APY 显示为 0

同一函数内还有：

```js
Date.now() < Date.UTC(2026, 4, 18, 2, 30, 0) &&
  (a.apy.apyWithFee = "0", a.apy.apyWithoutFee = "0")
```

### 含义

- JS 中 `month=4` = **2026-05-18 02:30:00 UTC** 之前：
  - 无论 API 返回多少，前端都把 APY 强制改成 **`"0"`**
- 审计抓取时（2026-07-17）该时间窗已结束，**当前不再触发**。
- 但这证明页面 APY **可被产品逻辑临时改写**，不是单纯透传。

## 4. 发现 F-03（中）：页面展示字段与对比条口径不一致风险

### 主 APY 展示（`EHJheCuG.js` / `LiteSupplyModal`）

```js
// 标签: "APY"
formatPercent(div(s.vault.apy.apyWithoutFee, "100").toFixed(4))
```

- 只展示 **`apyWithoutFee`**
- 不展示 `apyWithFee`
- 按官网文档语义，`apyWithoutFee` 对应 Net APY（已含 20% performance fee）

### 策略对比条

```js
[
  { name: "Hold ETH",   apy: "0" },
  { name: "Hold stETH", apy: s.vault.stETH.netStakingApr || "0" },
  { name: "stETH Vault", apy: s.vault.apy.apyWithoutFee },
]
```

并渲染为 `apy.toFixed(2) + "%"`。

### 问题

1. 对比条直接吃被 F-01/F-02 改写后的 `apyWithoutFee`，硬编码污染会同步进入营销对比图。
2. `Hold ETH = 0` 是写死的，不是市场数据。
3. 主数字先 `/100` 再 formatPercent；对比条把同一数量级直接加 `%`。当前 API 值约 `5.73` 时两边都能显示成约 `5.73%`，但实现路径不同，增加误读/回归风险。

## 5. 发现 F-04（低/信息）：蓝色提示文案复用同一被改写字段

同页 info banner：

> users are now earning {apyWithoutFee} APY ...

该文案同样绑定 `s.vault.apy.apyWithoutFee`，因此也会被 F-01/F-02 影响。

## 6. 当前时点复现结论（2026-07-17）

对 live API 做与前端相同的 mutate 模拟：

| 项目 | 值 |
|---|---|
| API raw `apyWithoutFee` | ~`5.7284` |
| API raw `apyWithFee` | ~`7.1605` |
| F-01 是否触发（`<1` 替换） | **否**（当前 >1） |
| F-02 是否触发（强制 0） | **否**（已过 2026-05-18） |
| 页面主展示字段 | `apyWithoutFee` |
| 用户当前大致看到 | ~`5.7284%`（Net） |

结论：

- **此刻**页面大概率显示接近 API 的 Net APY，硬编码回退未激活。
- 但代码路径仍在；一旦 API 再次返回 `<1%`，官网会自动显示 **2.97% / 3.71%**。

## 7. 审计结论（仅针对官网页面代码）

1. 官网 Lite ETH 页的 APY **不是只读透传**。
2. 存在明确的前端改写逻辑：
   - 低 APY 时硬编码为 `2.97` / `3.71`
   - 历史时间窗内强制为 `0`
3. 页面主展示使用 `apyWithoutFee`（Net），并同步用于对比条与提示文案。
4. 因此：“当真实计算结果很低（<1%）时，页面仍可能显示 2.97% / 3.71%” —— **该判断成立，且可在官网打包 JS 中直接取证。**

## 8. 建议（前端披露/修复）

1. 删除或显式开关化 F-01/F-02 硬编码；生产环境不应静默替换收益数字。
2. 若需兜底，应显示 `N/A` / `Unavailable`，并保留 raw API 值可核查。
3. 统一主 APY 与对比条的格式化函数，避免两套百分比路径。
4. 在 UI 明确标注展示的是 Net 还是 Gross，以及是否含 exit fee。
