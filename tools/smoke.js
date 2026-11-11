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

/* 绕圈走 + 持续开火。站着不动朝向不会变，打不到人，所以必须一边走一边打。
   每段按住 900ms 而不是几百毫秒——太短只是原地抖动，扫不到地图上的敌人。 */
async function circleFire(page, dirs, fireKey, ms) {
  await page.keyboard.down(fireKey);
  const step = 900;
  const loops = Math.max(1, Math.round(ms / step));
  let peakBullets = 0;
  let last = null;
  for (let i = 0; i < loops; i++) {
    const k = dirs[i % dirs.length];
    await page.keyboard.down(k);
    await sleep(step);
    await page.keyboard.up(k);
    last = await page.evaluate(() => window.__bqs.current());
    if (last.bullets > peakBullets) { peakBullets = last.bullets; }
  }
  await page.keyboard.up(fireKey);
  return { peakBullets, last };
}

/* 打到出结果为止：敌人分布是随机的，固定时长会时中时不中，
   固定时长跑出来的「失败」是运气不是回归。这里最多跑 maxMs，达标立刻停。 */
async function fireUntil(page, dirs, fireKey, done, maxMs) {
  const deadline = Date.now() + (maxMs || 24000);
  let peakBullets = 0;
  let last = null;
  while (Date.now() < deadline) {
    const r = await circleFire(page, dirs, fireKey, 5000);
    if (r.peakBullets > peakBullets) { peakBullets = r.peakBullets; }
    last = r.last;
    if (done(last)) { break; }
  }
  return { peakBullets, last };
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
    const fire = await fireUntil(page, ['KeyD', 'KeyS', 'KeyA', 'KeyW'], 'KeyJ',
      c => c.players[0].kills > 0, 24000);
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

    /* 战绩归属：只让 P1 开火，P2 的击杀必须保持 0 */
    const f1 = await fireUntil(page, ['KeyD', 'KeyS', 'KeyA', 'KeyW'], 'KeyJ',
      c => c.players[0].kills > 0, 24000);
    /* 停火后还要等一会：最后一轮打出的子弹仍在飞，落地补刀仍算 P1 的击杀，
       不等就取基线会把「残留子弹结算」误判成「P2 抢了 P1 的击杀」 */
    await sleep(1600);
    const only1 = await page.evaluate(() => window.__bqs.current());
    t.check('双人 · P1 开火有击杀', only1.players[0].kills > 0, 'P1 击杀=' + only1.players[0].kills);
    t.eq('双人 · P1 开火时 P2 击杀为 0', only1.players[1].kills, 0);
    t.eq('双人 · P1 开火时 P2 得分为 0', only1.players[1].score, 0);

    /* 换 P2 开火，P2 也要能打 */
    const f2 = await fireUntil(page, ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], 'ShiftRight',
      c => c.players[1].kills > 0, 24000);
    await sleep(1600);
    const only2 = await page.evaluate(() => window.__bqs.current());
    t.check('双人 · P2 开火有击杀', only2.players[1].kills > 0, 'P2 击杀=' + only2.players[1].kills);
    t.check('双人 · P2 得分独立累计', only2.players[1].score > 0, 'P2 得分=' + only2.players[1].score);
    t.check('双人 · P1 战绩未被 P2 影响', only2.players[0].kills === only1.players[0].kills,
      only1.players[0].kills + ' → ' + only2.players[0].kills);

    t.eq('双人 · 敌人不出界', only2.enemyOut, 0);
    t.check('双人 · 两人都在场内', only2.playerInset.every(v => v > 0), JSON.stringify(only2.playerInset));

    /* ---------------- 控制台 ---------------- */
    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
