/* ==========================================================
   arena-edge：异形边界压力
   ----------------------------------------------------------
   守的是「改物理 / 改刷怪 / 改地形时，实体还留在轮廓内」。

   做法：朝四个方向长时间顶边，高频采样玩家到边界的内距。
   内距是负值 = 已经跑到虚空里了，这是最严重的一类回归。
   ========================================================== */
const { launch, openGame, run, sleep } = require('./lib');

const DIRS = [
  { key: 'KeyD', name: '右' },
  { key: 'KeyS', name: '下' },
  { key: 'KeyA', name: '左' },
  { key: 'KeyW', name: '上' }
];

/* 顶着一个方向走 ms 毫秒，期间高频采样内距与敌人出界数 */
async function pushEdge(page, key, ms) {
  const samples = [];
  await page.keyboard.down(key);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(400);
    const c = await page.evaluate(() => window.__bqs.current());
    samples.push({ inset: c.playerInset[0], out: c.enemyOut });
  }
  await page.keyboard.up(key);
  return samples;
}

run('arena-edge 异形边界压力', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    await openGame(page, 'solo');

    let worstInset = Infinity;
    let totalOut = 0;

    for (const d of DIRS) {
      const s = await pushEdge(page, d.key, 5200);
      const minInset = Math.min.apply(null, s.map(x => x.inset));
      const outSum = s.reduce((a, x) => a + x.out, 0);
      worstInset = Math.min(worstInset, minInset);
      totalOut += outSum;

      /* 内距必须为正：>0 说明还在场内；掉到 <=0 就是把玩家挤进虚空了 */
      t.check('顶' + d.name + '边 · 玩家不越界', minInset > 0, '最小内距=' + minInset);
      t.eq('顶' + d.name + '边 · 敌人不出界', outSum, 0);
    }

    /* 测试有效性：如果全程内距都很大，说明根本没走到边上，这条测试其实没验证到东西 */
    t.check('测试有效性 · 确实贴到过边界', worstInset < 60, '全程最小内距=' + worstInset);

    /* 换几波看不同轮廓下是否同样成立 */
    for (const n of [3, 7]) {
      await page.evaluate(w => window.__bqs.startWave(w), n);
      await sleep(600);
      const c = await page.evaluate(() => window.__bqs.current());
      t.check('第 ' + n + ' 波 · 轮廓正常', c.arenaSides >= 5, c.arenaSides + ' 边 / ' + c.terrain);
      t.check('第 ' + n + ' 波 · 玩家在场内', c.playerInset[0] > 0, '内距=' + c.playerInset[0]);
      t.eq('第 ' + n + ' 波 · 敌人不出界', c.enemyOut, 0);

      /* 新轮廓下再顶一次边 */
      const s = await pushEdge(page, 'KeyD', 3600);
      const mi = Math.min.apply(null, s.map(x => x.inset));
      t.check('第 ' + n + ' 波 · 顶边不越界', mi > 0, '最小内距=' + mi);
    }

    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
