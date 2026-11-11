/* ==========================================================
   smoke：主流程冒烟（单人 + 双人）
   ----------------------------------------------------------
   守的是「主流程断了其他都白搭」：
     单人 进入 → 能动 → 能开火 → 能暂停 → 跳波正常
     双人 两人都在 → 各自能独立移动 → 战绩不串号

   双人是这个游戏的核心玩法，此前零自动化覆盖。
   最关键的一条断言是「只让 P1 开火时 P2 的击杀必须保持 0」——
   stats 归属一旦写错，这条会立刻炸。
   ========================================================== */
const { launch, openGame, run, sleep, BASE_URL } = require('./lib');

const PAD = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
];

/* 朝最近的敌人转向并开火。
   为什么要这么做：人物朝向跟随移动方向，敌人是追着玩家跑的，
   原地绕圈时敌人全在背后，子弹只会朝前打空——跑 24 秒也是 0 击杀，
   这种「失败」测的是运气不是回归。转向瞄准才能稳定命中。 */
async function aimFire(page, idx, fireKey, maxMs, stop) {
  const deadline = Date.now() + (maxMs || 24000);
  const pad = PAD[idx];
  let peakBullets = 0;
  let last = null;

  await page.keyboard.down(fireKey);
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__bqs.current());
    if (last.bullets > peakBullets) { peakBullets = last.bullets; }
    if (last.players[idx].kills > 0) { break; }
    if (stop && stop(last)) { break; }

    const me = last.players[idx];
    const list = last.enemies || [];
    if (!list.length) { await sleep(250); continue; }

    /* 取最近的敌人，按主轴（横/纵哪边偏得多）按方向键：朝向随即改变 */
    let best = null;
    let bestD = Infinity;
    for (const e of list) {
      const d = (e.x - me.x) * (e.x - me.x) + (e.y - me.y) * (e.y - me.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    const dx = best.x - me.x;
    const dy = best.y - me.y;
    const k = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? pad.right : pad.left)
      : (dy > 0 ? pad.down : pad.up);

    await page.keyboard.down(k);
    await sleep(300);
    await page.keyboard.up(k);
  }
  await page.keyboard.up(fireKey);
  return { peakBullets, last };
}

/* 双人单方面开火：只有 idx 这位在打，另一位站着不动当活靶子。
   站桩的队友会被敌人围殴——一旦倒地甚至整局结算，
   后续断言就等于在结算界面上做，结论全部无意义。所以这里同时
   返回局面是否仍然有效，由调用方决定重开。 */
async function duoFirePhase(page, fireKey, idx, maxMs) {
  const r = await aimFire(page, idx, fireKey, maxMs,
    c => c.state !== 'playing' || c.players[1 - idx].downed);
  /* 停火后子弹仍在飞，落地补刀仍算本人的击杀，等结算完再取基线 */
  await sleep(1600);
  const c = await page.evaluate(() => window.__bqs.current());
  return { peakBullets: r.peakBullets, c };
}

run('smoke 主流程（单人 + 双人）', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    /* ---------------- 单人 ---------------- */
    let c = await openGame(page, 'solo');
    t.eq('单人 · 模式', c.mode, 'solo');
    t.eq('单人 · 进入游戏', c.state, 'playing');
    t.eq('单人 · 玩家数', c.players.length, 1);
    t.check('单人 · 地形已生成', !!c.terrain, c.terrain);
    t.check('单人 · 场地是多边形', c.arenaSides >= 5, c.arenaSides + ' 边');

    /* 移动 */
    const x0 = c.players[0].x;
    await page.keyboard.down('KeyD');
    await sleep(700);
    await page.keyboard.up('KeyD');
    const moved = (await page.evaluate(() => window.__bqs.current())).players[0].x;
    t.check('单人 · 能移动', moved !== x0, x0 + ' → ' + moved);

    /* 开火 → 击杀。15 秒足够清掉第 1 波的 4 个敌人；
       同时用「在飞子弹数」验证开火链路本身，即使运气差没打中也不误判 */
    const fire = await aimFire(page, 0, 'KeyJ', 24000);
    let s = fire.last;
    t.check('单人 · 开火产生子弹', fire.peakBullets > 0, '峰值 ' + fire.peakBullets + ' 发在飞');
    t.check('单人 · 开火能击杀', s.players[0].kills > 0, '击杀=' + s.players[0].kills + ' 剩余敌人=' + s.enemyAlive);
    t.check('单人 · 击杀同步计分', s.players[0].score > 0, '得分=' + s.players[0].score);
    t.check('单人 · 未出界', s.playerInset[0] > 0, '内距=' + s.playerInset[0]);
    t.eq('单人 · 敌人不出界', s.enemyOut, 0);

    /* 暂停 / 继续 */
    await page.keyboard.press('Escape');
    await sleep(500);
    t.eq('单人 · ESC 暂停', (await page.evaluate(() => window.__bqs.current())).state, 'paused');
    await page.keyboard.press('Escape');
    await sleep(500);
    t.eq('单人 · ESC 继续', (await page.evaluate(() => window.__bqs.current())).state, 'playing');

    /* 跳波：地形要换、场地要重建 */
    await page.evaluate(() => window.__bqs.startWave(3));
    await sleep(500);
    const w3 = await page.evaluate(() => window.__bqs.current());
    t.eq('单人 · 跳波成功', w3.wave, 3);
    t.check('单人 · 第 3 波地形已生成', !!w3.terrain && w3.obstacles > 0, w3.terrain + '/' + w3.obstacles + ' 障碍');
    t.check('单人 · 面积归一 ≈1.12', Math.abs(w3.arenaFill - 1.12) < 0.02, 'arenaFill=' + w3.arenaFill);

    /* ---------------- 双人 ---------------- */
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__bqs, null, { timeout: 15000 });
    await sleep(300);
    await page.click('[data-action="duo"]');
    await sleep(800);

    let d = await page.evaluate(() => window.__bqs.current());
    t.eq('双人 · 模式', d.mode, 'duo');
    t.eq('双人 · 玩家数', d.players.length, 2);
    t.check('双人 · 两人都存活', d.players[0].alive && d.players[1].alive);

    /* 独立移动：P1 按 D 往右，P2 按 ← 往左，方向必须相反 */
    const before = d.players.map(p => p.x);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowLeft');
    await sleep(800);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowLeft');
    await sleep(200);
    const after = (await page.evaluate(() => window.__bqs.current())).players;
    const p1dx = after[0].x - before[0];
    const p2dx = after[1].x - before[1];
    t.check('双人 · P1 能独立移动', p1dx > 4, 'Δx=' + p1dx);
    t.check('双人 · P2 能独立移动', p2dx < -4, 'Δx=' + p2dx);
    t.check('双人 · 两人互不干扰', p1dx > 0 && p2dx < 0, 'P1 +' + p1dx + ' / P2 ' + p2dx);

    /* 战绩归属：只让 P1 开火，P2 的击杀必须保持 0；
       再换 P2 开火，P2 也要能打。
       两段都是「一个人打、一个人站桩」，站桩那位会被围殴倒地，
       一旦如此局面就作废（后面等于在结算界面上做断言），整段重开。 */
    let only1 = null;
    let only2 = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) { await openGame(page, 'duo'); }

      const a = await duoFirePhase(page, 'KeyJ', 0, 24000);
      if (a.c.state !== 'playing' || a.c.players[0].downed || a.c.players[1].downed) {
        t.info('第 ' + attempt + ' 局作废：P1 阶段局面已结束（队友被打倒或提前结算），重开');
        continue;
      }
      only1 = a.c;

      const b = await duoFirePhase(page, 'ShiftRight', 1, 24000);
      if (b.c.state !== 'playing' || b.c.players[1].downed) {
        t.info('第 ' + attempt + ' 局作废：P2 阶段局面已结束（被打倒或提前结算），重开');
        continue;
      }
      only2 = b.c;
      break;
    }

    if (!only2) {
      t.fail('双人 · 三局都没拿到有效对局',
        '站桩的那一方连续被打倒，无法验证战绩归属；请检查敌人强度或救援参数');
    } else {
      t.check('双人 · P1 开火有击杀', only1.players[0].kills > 0, 'P1 击杀=' + only1.players[0].kills);
      t.eq('双人 · P1 开火时 P2 击杀为 0', only1.players[1].kills, 0);
      t.eq('双人 · P1 开火时 P2 得分为 0', only1.players[1].score, 0);
      t.check('双人 · P2 开火有击杀', only2.players[1].kills > 0, 'P2 击杀=' + only2.players[1].kills);
      t.check('双人 · P2 得分独立累计', only2.players[1].score > 0, 'P2 得分=' + only2.players[1].score);
      t.check('双人 · P1 战绩未被 P2 影响', only2.players[0].kills === only1.players[0].kills,
      only1.players[0].kills + ' → ' + only2.players[0].kills);

      t.eq('双人 · 敌人不出界', only2.enemyOut, 0);
      t.check('双人 · 两人都在场内', only2.playerInset.every(v => v > 0), JSON.stringify(only2.playerInset));
    }

    /* ---------------- 控制台 ---------------- */
    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
