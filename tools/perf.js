/* ==========================================================
   perf：性能守卫
   ----------------------------------------------------------
   守的是「加特效 / 加敌人 / 改地形后不至于掉帧」。

   两个指标：
     切波同步耗时 —— buildArena + 地形缩放 + arenaDist 过滤的总和，
                    卡在这里会表现为切波瞬间掉帧
     战斗帧间隔   —— p95 超过 25ms 就说明 60fps 已经不稳了
   ========================================================== */
const { launch, openGame, run, sleep } = require('./lib');

run('perf 性能守卫', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    await openGame(page, 'solo');
    await sleep(600);

    /* 连续切 12 波，记录每次的同步耗时 */
    const costs = await page.evaluate(() => {
      const out = [];
      for (let n = 1; n <= 12; n++) {
        const t0 = performance.now();
        window.__bqs.startWave(n);
        out.push(Math.round((performance.now() - t0) * 100) / 100);
      }
      return out;
    });
    const maxCost = Math.max.apply(null, costs);
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    t.info('切波耗时(ms): ' + costs.join(', '));
    t.check('切波同步耗时 < 30ms', maxCost < 30, '最慢 ' + maxCost + 'ms / 平均 ' + avgCost.toFixed(2) + 'ms');

    /* 战斗中采帧 */
    await page.evaluate(() => window.__bqs.startWave(3));
    await sleep(800);

    const frames = await page.evaluate(() => new Promise(resolve => {
      const arr = [];
      let last = performance.now();
      let n = 0;
      function tick() {
        const now = performance.now();
        arr.push(now - last);
        last = now;
        if (++n < 240) { requestAnimationFrame(tick); return; }
        arr.shift();
        const sorted = arr.slice().sort((a, b) => a - b);
        resolve({
          avg: arr.reduce((a, b) => a + b, 0) / arr.length,
          p95: sorted[Math.floor(sorted.length * 0.95)],
          max: sorted[sorted.length - 1]
        });
      }
      requestAnimationFrame(tick);
    }));

    t.info('帧间隔: 平均 ' + frames.avg.toFixed(1) + 'ms / p95 ' + frames.p95.toFixed(1) +
           'ms / 最差 ' + frames.max.toFixed(1) + 'ms');
    t.check('平均帧间隔 ≈ 60fps', frames.avg < 20, frames.avg.toFixed(1) + 'ms');
    t.check('p95 帧间隔 < 25ms', frames.p95 < 25, frames.p95.toFixed(1) + 'ms');

    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
