# Bug清剿小队（Bug Purge Squad）· trontank

> 一个零依赖、单文件的俯视角双摇杆射击小游戏。复刻自 WorkBuddy 社区的原创作品，并在其基础上增加了 **WebHID 手柄支持**、**P1/P2 手柄分配** 与 **拾取磁吸** 等改动。

本文档面向 agent / 协作者，重点说明项目结构、设计思路与**所有可调参数**，便于快速理解与二次开发。

---

## 1. 项目简介

- **玩法**：俯视角（top-down）双摇杆射击。玩家清除不断涌出的「异常数据体（bug）」，守护中央数据核心。
- **模式**：单人（solo）/ 双人同屏（duo，同一键盘分控）。
- **核心循环**：清波 → 整备（选增益卡）→ 下一波；三档难度。
- **内容**：4 种武器（手枪/冲锋枪/散射霰弹/穿透光束）、3 种补给（修复药剂/护盾/超频芯片）、墙面武器架、地面宝箱、小地图、镜头跟随、倒地救援、热修复连携、本地最高分、全屏。
- **美术与音效**：全部由代码程序生成（Canvas 绘制 + WebAudio 合成），**无任何外部素材**。

---

## 2. 运行与部署（重要）

- **唯一文件**：`index.html`（约 21 万字节，自包含：1 个 `<style>` + 1 个 `<script>`，无 CDN、无外链、无构建步骤）。
- **本地预览**：用 WorkBuddy 内置预览（走 `localhost`，可直接用手柄）或浏览器打开。
- **外部浏览器 / 部署**：
  - 纯静态站点即可，**无需后端、数据库或运行时**。
  - ⚠️ **必须 HTTPS（或 `localhost`）访问**。手柄的 **WebHID API 只在安全上下文下可用**；用 `file://` 双击打开或纯 `http://域名` 访问时，`navigator.hid` 会被浏览器禁用，页面会提示改用 `http://localhost` 或 https。
  - 宝塔部署：新建静态站点 → 上传 `index.html` → 开启 SSL（Let's Encrypt）→ 访问 `https://你的域名/`。

---

## 3. 架构概览

整个游戏是单文件，按「常量 → 数据 → 工具 → 系统 → 主循环」组织，关键锚点（行号随改动可能偏移，以搜索为准）：

| 区块 | 作用 | 关键标识 |
|---|---|---|
| `var CFG = {...}` | 全局可调平衡参数（玩家/拾取） | `CFG` |
| `DIFFS` | 难度倍率 | `DIFFS`, `difficulty` |
| `WEAPONS` / `SUPPLIES` | 武器与补给的数据驱动定义 | `WEAPONS`, `SUPPLIES` |
| `TERRAIN_SETS` | 每波的地形/武器架/宝箱布局 | `TERRAIN_SETS` |
| 敌人定义 | bit/block/tri/hex 四类异常体 | `enemyTypes` |
| `makePlayer` | 玩家对象初始化（半径取自 `CFG.playerR`） | `makePlayer` |
| `updatePickups` | 掉落物磁吸 + 拾取判定 | `updatePickups` |
| `pollGamepads` / `gpRead` / `hidBuildPseudo` | 手柄输入（标准 API + WebHID） | 见第 6 节 |
| 主循环 | `loop()` → `update(dt)` → 渲染 | `function update` |

持久化使用 `store`（localStorage 封装），键名带版本后缀（如 `bqs.diff.v1`、`bqs.binds.v1`、`bqs.gpTarget.v1`）。

---

## 4. 设计思路

1. **单文件、零依赖**：便于直接发布为静态页、离线运行、无构建链路。任何新功能都应尽量保持「不改外部依赖」。
2. **数据驱动平衡**：武器/补给/难度/地形都是纯数据对象，改数值即可调玩法，不必动逻辑。
3. **流程优先于精准**：拾取改为「磁吸 + 放大判定半径」，玩家路过装备即自动入袋，避免必须精确走到道具上影响流畅度（见 `CFG.pickupRadius` / `pickupAttractR` / `pickupAttractSpeed`）。
4. **手柄兼容分层**：
   - 标准手柄（Xbox/PS）走浏览器原生 `Gamepad API`（`gpRead` 解析标准按钮索引）。
   - **Switch Pro Controller / Joy-Con 在 macOS 上不被 Gamepad API 暴露**（它是 BLE HID，系统手柄层跳过），因此额外实现 **WebHID 直连**，直接解析其 `0x30` 输入报告（`hidBuildPseudo`）。两条路径最终都喂给同一套 `padHeld` 输入状态，逻辑统一。
5. **可配置的手柄归属**：双人模式下可在「按键设置」里指定第 1 只手柄归 P1、P2 还是双柄各一（`gamepadTarget`）。

---

## 5. 操作方式

### 键盘（默认，可在「按键设置」中修改）
- **1P**：`WASD` 移动，`J` 射击，`Q` 切枪，`E` 投弹；方向键也可移动。
- **2P**：方向键移动，`右Shift` 射击，`/` 切枪，`.` 投弹。
- **通用**：`P` / `Esc` 暂停；`R` 重开；`F` 全屏；`1-3` 选卡。

### 手柄（需 Chrome/Edge + HTTPS/localhost）
- 左摇杆 / 十字键：移动；`A` 或 `ZR`：射击（按住）；`X`：切枪；`Y`：投弹。
- 菜单：`A`=单人，`Y`=双人，`+`=操作说明，`-`=按键设置。
- 战斗中：`+`=暂停；整备选卡：左右移动 + `A`/射击确认。

---

## 6. 开发可调参数

> 改完数值即生效，无需构建。所有「平衡类」参数都集中在少数几个对象里，优先在这里调，避免散落硬编码。

### 6.1 全局平衡 `var CFG = {...}` （玩家 + 拾取）
| 参数 | 默认值 | 含义 |
|---|---|---|
| `playerR` | 15 | 玩家碰撞/判定半径 |
| `playerHp` | 100 | 玩家生命上限 |
| `playerSpeed` | 215 | 移动速度（px/s） |
| `fireInterval` | 0.30 | 基础射击间隔（秒） |
| `damage` | 10 | 基础单发伤害 |
| `bulletSpeed` | 680 | 子弹速度（px/s） |
| `bulletR` | 4 | 子弹半径 |
| `hitInv` | 1.2 | 受击无敌帧（秒），被围时给脱身机会 |
| `reviveRatio` | 0.85 | 倒地救援后回血比例 |
| `pickupRadius` | 22 | 拾取触发半径（与玩家半径相加）。原 9（≈需走到 24px），现 22（≈37px，路过即捡） |
| `pickupAttractR` | 72 | 磁吸半径（px）：玩家进入此范围，掉落物主动飞向角色 |
| `pickupAttractSpeed` | 280 | 磁吸最大速度（px/s），越近吸得越快 |
| `aimAssistEnabled` | true | 瞄准辅助（小角度自动修正）总开关，一键回退 |
| `aimAssistAngle` | 10 | 默认最大修正角（度）：玩家射线与敌人偏差≤此值才修正，超出不修正（保留瞄准手感） |
| `aimAssistRange` | 360 | 只辅助此距离内的敌人（px）；0 = 不限距离 |

> **每武器差异化**：`WEAPONS` 里可用 `aimAssist` 字段单独覆盖上述角度——例如 `beam` 设 16（单发高伤、容错低，给更大修正），`scatter` 设 0（自身 26° 扇形已覆盖错位，不需额外修正），未设则沿用全局 10°。

### 6.2 拾取相关常量（独立于 CFG，控制节奏）
| 常量 | 默认 | 含义 |
|---|---|---|
| `PICKUP_ARM` | 0.45 | 开箱后落地保护时间，避免瞬间被吸走 |
| `CHEST_RESPAWN` | 15 | 宝箱开启后重新刷新的秒数 |
| `CHEST_ARM` | 0.6 | 刷新后短暂保护，防站在箱上连开 |
| `PICKUP_CAP` | 24 | 场上掉落物上限，防无限堆积 |
| `PICKUP_CLEAR_R` | 10 | 掉落物与障碍最小间距，保证可被靠近 |

### 6.3 难度 `var DIFFS = {...}`（倍率，非绝对值）
| 难度 | 标签 | hp | count | dmg | heal |
|---|---|---|---|---|---|
| `easy` | 休闲 | 0.75 | 0.80 | 0.75 | 0.15 |
| `normal` | 标准 | 1.00 | 1.00 | 1.00 | 0.12 |
| `hard` | 挑战 | 1.25 | 1.20 | 1.25 | 0.08 |

（hp=敌人血量倍率，count=数量倍率，dmg=伤害倍率，heal=波间回血比例）

### 6.4 武器 `WEAPONS`（数据驱动，改数值即可）
字段：`interval`(射击间隔) / `damage`(单发伤害) / `bulletSpeed` / `bulletR` / `count`(每次弹丸数) / `spread`(扇形角) / `jitter`(散布) / `pierce`(穿透数) / `life`(子弹存活) / `ammo`(-1=无限)。
- `pistol` 手枪：无限弹，直线单发（默认武器，0 号位固定）。
- `scatter` 散射霰弹：5 发扇形，贴脸强（ammo 20）。
- `smg` 冲锋枪：高射速低伤，有散布（ammo 60）。
- `beam` 穿透光束：高伤慢速，穿透 3 个目标（ammo 14）。

### 6.5 补给 `SUPPLIES`
- `potion` 修复药剂：立即回血 35。
- `shield` 护盾发生器：护盾 +1（可挡一次伤害，上限 3）。
- `overclock` 超频芯片：8 秒内射速 +35%。

### 6.6 炸弹 `var BOMB = {...}`
`fuse` 0.7 / `speed` 430 / `radius` 96 / `selfMax` 55 / `selfMin` 12 / `enemyMax` 130 / `enemyMin` 45 / `maxCarry` 3（伤敌也伤己，中心伤害最高、边缘递减）。

### 6.7 世界与敌人
- 世界尺寸：`WW = 1728`, `WH = 972`。
- 敌人类型（`enemyTypes`）：`bit`(hp10,spd92,r12,score100) / `block`(hp22,spd62,r13,score150) / `tri`(hp16,spd112,r14,score170) / `hex`(hp32,spd56,r17,score230)。
- 地形布局：`TERRAIN_SETS`（每波的重生点、武器架、宝箱坐标，纯数据，可增删）。

### 6.8 手柄配置
- **WebHID 过滤设备**（`requestGamepad` 的 `filters`）：Switch `vendorId 0x057e` 的 `productId 0x2009`(Pro Controller) / `0x2006`(Joy-Con L) / `0x2007`(Joy-Con R)。要支持其他蓝牙手柄，在此加 filter 并在 `hidBuildPseudo` 里加对应报告解析。
- **标准手柄按钮索引**（`gpRead`）：A=0, B=1, X=2, Y=3, ZR=7, Minus=8, Plus=9, 十字键 12–15。
- **手柄归属** `gamepadTarget`：取值 `'p1'` / `'p2'` / `'both'`（默认 `'both'`）；单人模式恒为 P1。配置存于 `bqs.gpTarget.v1`。

---

## 7. 已知限制与注意事项

- **WebHID 仅 Chrome / Edge 支持**，Safari 无效（按钮会提示「此浏览器不支持」）。
- **务必 HTTPS/localhost**：否则手柄完全不可用（`file://` 与纯 http 都会被禁）。
- Switch 的 **Home 键是系统保留键**，网页层无法拦截（属正常，不影响游戏）。
- 手柄键位用的是标准索引假设；若实测某键不对，改 `gpRead` / `hidBuildPseudo` 里对应的位/索引即可（一行级改动）。

---

## 8. 文件清单

```
trontank/
├── index.html     # 游戏本体（单文件、自包含）
├── README.md      # 本文件
└── .gitignore     # 忽略 .workbuddy/ 与 .DS_Store
```

## 9. 改动记录（本仓库）

- `init`：复刻原版单文件游戏。
- `feat: 拾取范围变量化 + 磁吸`：新增磁吸机制，`CFG.pickupRadius/pickupAttractR/pickupAttractSpeed` 控制拾取手感。
- （更早）新增 WebHID 手柄直连、P1/P2 手柄分配配置。
