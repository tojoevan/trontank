/* ==========================================================
   leak：长局对象泄漏
   ----------------------------------------------------------
   守的是「玩了半小时才开始卡」这类问题：子弹、粒子、浮动文字、
   爆炸、掉落物这些数组如果只增不减，帧率会随游戏时长缓慢坍塌，
   而短时间的性能测试（perf 只跑十几秒）根本看不出来。

   做法：调试接口的 step(n) 按固定步长同步推进 update()，
   3000 帧只要几十毫秒（真实 rAF 要 50 秒）。只推进逻辑不渲染，
   渲染性能由 perf 用例单独守。

   三个方向夹住泄漏：
     1. 排空：停手之后子弹必须归零，特效必须落回地板值
     2. 峰值：连续十个回合里，各数组峰值不得超过硬上限
     3. 起点：每个回合重开时，数组规模必须一致——这是最锋利的一条，
        只要 startGame 漏清一个数组，第 N 局的起点就会高于第 1 局
   ========================================================== */
const { launch, openGame, run, sleep } = require('./lib');

const cur = page => page.evaluate(() => window.__bqs.current());
const step = (page, n, dt) =>
  page.evaluate(a => window.__bqs.step(a.n, a.dt), { n: n, dt: dt || 1 / 60 });

/* 重开 + 立刻取快照，必须在同一次 evaluate 里完成：
   真实 rAF 循环是同时跑着的，两次 evaluate 之间隔了一帧，
   足够人物打出一发子弹 —— 那样测到的「起点」就不是 startGame 的起点，
   而是「起点 + 一帧」。（第一版就栽在这，假报了 bullets 漂移） */
const restartSnap = page => page.evaluate(() => {
  window.__bqs.restart('solo');
  return window.__bqs.current();
});
const restart = page => page.evaluate(() => window.__bqs.restart('solo'));

/* 硬上限：比实测峰值留足余量，只用来抓「无上界增长」 */
const CAP = {
  particles: 720,     // 代码里自己封顶 700（超了直接不生成）
  floaters: 200,
  rings: 300,
  bombs: 40,
  explosions: 60,
  bullets: 400,
  enemies: 200,
  pickups: 24,        // PICKUP_CAP
  chests: 40,
  mounts: 40
};

const pick = c => ({
  particles: c.particles, floaters: c.floaters, rings: c.rings,
  bombs: c.bombs, explosions: c.explosions, bullets: c.bullets,
  enemies: c.enemyAlive, pickups: c.pickups, chests: c.chests, mounts: c.mounts
});

run('leak 长局对象泄漏', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    await openGame(page, 'solo');
    await restart(page);
    await sleep(200);

    /* ---------- 1. 子弹排空：停火后必须归零 ---------- */
    await page.keyboard.down('KeyJ');
    await sleep(150);
    let peakBullets = 0;
    for (let i = 0; i < 12; i++) {
      await step(page, 10);
      const c = await cur(page);
      if (c.bullets > peakBullets) { peakBullets = c.bullets; }
    }
    await page.keyboard.up('KeyJ');
    const afterFire = await cur(page);
    t.check('开火 · 子弹确实在生成', peakBullets > 0, '峰值 ' + peakBullets + ' 发');

    const drained = await step(page, 240);          // 4 秒逻辑时间，足够任何子弹飞完/过期
    let c = await cur(page);
    t.eq('子弹 · 停火 4 秒后归零', c.bullets, 0);
    t.check('子弹 · 排空过程没有把局面打崩', c.state === 'playing',
      'state=' + c.state + ' 推进 ' + drained + ' 帧');

    /* ---------- 2. 十回合长跑：峰值受控 + 起点一致 ---------- */
    await page.keyboard.down('KeyJ');               // 全程开火，制造持续的对象创建/销毁
    await sleep(120);

    const starts = [];
    const peaks = {};
    Object.keys(CAP).forEach(k => { peaks[k] = 0; });
    let rounds = 0;
    let frames = 0;

    for (let r = 0; r < 10; r++) {
      const base = pick(await restartSnap(page));
      starts.push(base);

      /* 一回合最多 600 帧（10 秒逻辑时间）；提前团灭就进下一局 */
      for (let k = 0; k < 6; k++) {
        await step(page, 100);
        frames += 100;
        const now = pick(await cur(page));
        Object.keys(CAP).forEach(key => {
          if (now[key] > peaks[key]) { peaks[key] = now[key]; }
        });
        const st = await cur(page);
        if (st.state !== 'playing') { break; }
      }
      rounds++;
    }
    await page.keyboard.up('KeyJ');

    t.check('长跑 · 跑完 10 个回合', rounds === 10, '共推进 ' + frames + ' 帧');

    /* 峰值上限：只抓无上界增长，正常波动不该报警 */
    Object.keys(CAP).forEach(k => {
      t.check('峰值 · ' + k + ' ≤ ' + CAP[k], peaks[k] <= CAP[k], '实测峰值 ' + peaks[k]);
    });

    /* 起点一致：这是最关键的一条。startGame 若漏清某个数组，
       第 2 局起就会带着上一局的残留，曲线一路往上。
       宝箱不在此列——它的数量随本局场地面积浮动（密度守恒），
       每局种子不同就可能 2 或 3 个，那是设计如此，不是泄漏。 */
    const MUST_SAME = ['particles', 'floaters', 'rings', 'bombs', 'explosions',
      'bullets', 'enemies', 'pickups', 'mounts'];
    const drift = MUST_SAME.filter(k => starts.some(s => s[k] !== starts[0][k]));
    t.check('起点 · 每局重开数组规模一致', drift.length === 0,
      drift.length
        ? '漂移字段: ' + drift.map(k => k + '(' + starts.map(s => s[k]).join('→') + ')').join(', ')
        : '10 局起点完全相同');

    const chestVals = starts.map(s => s.chests);
    t.check('起点 · 宝箱数量稳定（随场地面积浮动）',
      Math.max.apply(null, chestVals) - Math.min.apply(null, chestVals) <= 3,
      '各局: ' + chestVals.join(','));

    t.info('第 1 局起点: ' + JSON.stringify(starts[0]));

    /* ---------- 3. 换局清空：上一局最花的时候重开，残留必须归零 ---------- */
    await page.keyboard.down('KeyJ');
    await sleep(120);
    /* 特效寿命只有 0.3~0.95 秒，粗粒度采样会正好落在「刚散干净」的瞬间，
       所以小步推进、一出现就取样（第一版按 60 帧一采，三次里两次采到空） */
    let busy = null;
    for (let k = 0; k < 240; k++) {
      await step(page, 10);
      const s = await cur(page);
      if (s.particles + s.floaters + s.rings > 0) { busy = s; break; }
      if (s.state !== 'playing') { break; }
    }
    t.check('特效 · 战斗时确实有东西在飞', !!busy,
      busy ? 'particles=' + busy.particles + ' floaters=' + busy.floaters + ' rings=' + busy.rings
        : '整局没采到任何特效');

    await page.keyboard.up('KeyJ');
    c = await restartSnap(page);
    t.eq('换局 · 粒子被清空', c.particles, 0);
    t.eq('换局 · 浮动文字被清空', c.floaters, 0);
    t.eq('换局 · 子弹被清空', c.bullets, 0);
    t.eq('换局 · 爆炸被清空', c.explosions, 0);
    t.check('换局 · 冲击环只剩开局光环', c.rings <= 2, 'rings=' + c.rings);

    /* ---------- 4. 一整局的完整生命周期不残留 ---------- */
    await page.keyboard.down('KeyJ');
    await sleep(120);
    /* 一直推到团灭或 20 秒（1200 帧），再自然结算 */
    for (let k = 0; k < 12; k++) {
      await step(page, 100);
      const st = await cur(page);
      if (st.state !== 'playing') { break; }
    }
    await page.keyboard.up('KeyJ');
    const dead = await cur(page);
    t.info('一局结束时的状态: state=' + dead.state + ' wave=' + dead.wave +
      ' 击杀=' + dead.players[0].kills);

    const before = pick(await cur(page));
    await step(page, 300);                          // 结算后继续推 5 秒
    const after = await cur(page);
    t.check('结算后 · 子弹不再累积', after.bullets <= before.bullets,
      before.bullets + ' → ' + after.bullets);
    t.check('结算后 · 特效会自然消散',
      after.particles <= 60 && after.floaters <= 20 && after.rings <= 20,
      'particles=' + after.particles + ' floaters=' + after.floaters + ' rings=' + after.rings);

    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
