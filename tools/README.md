# tools/ — 回归验证

单文件项目没有构建步骤、没有类型检查，这个目录承担 CI 的角色。

## 用法

```bash
./tools/verify.sh              # 全量：lint + 冒烟 + 边界 + 顺序 + 密度 + 性能（约 1.5 分钟）
./tools/verify.sh --fast       # 只跑 lint + 冒烟（约 1 分钟，改小东西时用）
./tools/verify.sh smoke order  # 只跑指定几项
```

本地没起服务时会自动拉起一个静态服务器，跑完自动关。

## 各项守什么

| 用例 | 守的东西 | 什么时候必须跑 |
|---|---|---|
| `lint` | 脚本语法、HTML 骨架、关键函数是否被误删、调试接口是否泄漏、体积 | 每次改完 |
| `smoke` | 单人/双人主流程；**双人战绩不串号**（只让 P1 开火时 P2 击杀必须为 0）。开火前会朝最近的敌人转向（`aimFire`），不靠绕圈碰运气；局面被打崩（站桩队友倒地/提前结算）会自动重开，最多 3 局 | 每次改完 |
| `arena-edge` | 四方向顶边，玩家内距不得 ≤0；敌人不得跑到轮廓外 | 动碰撞、刷怪、地形 |
| `order` | 休闲/标准同一关每局一致，挑战每局不同；同局内重建结果一致 | 动种子、地形池、洗牌 |
| `density` | 出怪数符合 `√(面积比)` 系数、场地不小于原矩形战场、宝箱不落在墙里 | 动 `arenaFill`、数量公式、补给生成 |
| `perf` | 切波同步耗时 <30ms、p95 帧间隔 <25ms | 加特效、加敌人、改渲染 |

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `49460` | 本地服务端口 |
| `BASE_URL` | `http://127.0.0.1:$PORT/index.html?debug` | 指向已部署的实例也可以 |
| `CHROME_PATH` | 自动探测 | 指定 Chromium/Chrome 可执行文件 |
| `PLAYWRIGHT_MODULE` | 自动探测 | 指定 playwright 模块路径 |

`lib.js` 的探测顺序：环境变量 → 项目 `node_modules` → WorkBuddy 内置 node → `~/Library/Caches/ms-playwright`（按版本号取最新）→ 系统 Chrome。

## 写新用例

```js
const { launch, openGame, run, sleep } = require('./lib');

run('xxx 名称', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    const c = await openGame(page, 'solo');   // 或 'duo'
    t.check('断言描述', c.state === 'playing', '附加信息');
    t.eq('值相等', c.wave, 1);
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
```

`t.check(label, ok, detail)` / `t.eq(label, actual, expected)` / `t.info(msg)`，`run()` 会自动收尾并设置退出码。

## 两个坑

1. **不要用固定时长判断「能不能打到人」**：敌人分布是随机的，固定时长跑出来的失败是运气不是回归。用 `fireUntil()` 那种「达标即停」的写法。
2. **停火后要等一会再取基线**：最后一轮打出的子弹还在飞，落地补刀仍算原玩家的击杀。不等就把「残留子弹结算」误判成「抢击杀」（曾经因此出现过一次假失败）。

## 调试接口

所有用例依赖页面带 `?debug` 打开后挂上的 `window.__bqs`：

- `current()` —— 状态快照：`state / wave / mode / difficulty / players[] / terrain / obstacles / bullets / enemyAlive / enemyOnScreen / spawnPlanned / spawnLeft / chests / chestBad / mounts / arenaSides / arenaBB / arenaFill / playerInset / enemyOut / arena[]`
- `startWave(n)` —— 直接跳到第 n 波
- `reroll()` —— 重掷地形序列
- `terrainForWave(n)` —— 只算地形不落地

`players[]` 里有 `id / x / y / alive / downed / hp / score / kills / weapon / ammo / weaponCount`，双人的战绩归属全靠它验证。
