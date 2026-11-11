/* ==========================================================
   density：密度守恒
   ----------------------------------------------------------
   守的是这条设计约定（见 index.html 的 arenaDensityFactor 注释）：
     · 敌人数按 sqrt(场地面积 / 原矩形战场面积) 缩放
       —— 调 CFG.arenaFill 只该改地图大小，不该顺带改难度
     · 场地面积必须 ≥ 原矩形战场（异形削角不能把可活动面积吃掉）
     · 宝箱随面积变多，且额外撒出来的点不能落在墙里或场外

   为什么盯这三条：
   面积归一和数量缩放是两处独立代码，任一处被「顺手改成按面积比」
   都会让难度悄悄漂移，而单局试玩完全看不出来。
   ========================================================== */
const { launch, run, sleep, BASE_URL } = require('./lib');

const WAVES = [1, 4, 10, 20];

/* 与 index.html 的 startWave 保持同一套运算顺序：
   基础量 → ×双人/难度 → ×面积系数 → 取整 → 精英波 ×0.55 → +1 boss → 下限 3 */
function planned(wave, modeMul, factor) {
  let n = Math.round(3 + wave * 1.4);
  n = Math.round(n * modeMul * factor);
  if (wave % 5 === 0) { n = Math.round(n * 0.55) + 1; }
  return Math.max(3, n);
}

run('density 密度守恒', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__bqs, null, { timeout: 15000 });
    await sleep(250);
    await page.click('[data-action="solo"]');
    await sleep(650);

    for (const n of WAVES) {
      const c = await page.evaluate(w => { window.__bqs.startWave(w); return window.__bqs.current(); }, n);
      const fill = c.arenaArea / (c.world.w * c.world.h);
      const factor = Math.min(1.8, Math.max(0.7, Math.sqrt(fill)));

      /* 标准难度、单人：3+1.4n 是唯一的数量公式。
         精英波除了数量 ×0.55，还会额外插入一只 boss（不参与乘法），所以最后 +1 */
      const expect = planned(n, 1, factor);

      t.check('W' + n + ' · 出怪数符合面积系数',
        Math.abs(c.spawnPlanned - expect) <= 1,
        '实际=' + c.spawnPlanned + ' 期望≈' + expect + '（面积系数 ' + factor.toFixed(3) + '）');

      t.check('W' + n + ' · 场地不小于原矩形战场',
        fill >= 1.0,
        'fill=' + fill.toFixed(3) + ' 面积=' + c.arenaArea);

      t.check('W' + n + ' · 宝箱落点合法', c.chestBad === 0,
        '宝箱=' + c.chests + ' 异常=' + c.chestBad);

      t.check('W' + n + ' · 补给数量未减少', c.chests >= 2 && c.mounts >= 1,
        '宝箱=' + c.chests + ' 武器架=' + c.mounts);
    }

    /* 双人不是简单翻倍，单独确认系数仍在（1.35） */
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__bqs, null, { timeout: 15000 });
    await sleep(250);
    await page.click('[data-action="duo"]');
    await sleep(650);
    const duo = await page.evaluate(() => { window.__bqs.startWave(10); return window.__bqs.current(); });
    const duoFill = duo.arenaArea / (duo.world.w * duo.world.h);
    const duoFactor = Math.min(1.8, Math.max(0.7, Math.sqrt(duoFill)));
    const duoExpect = planned(10, 1.35, duoFactor);
    t.check('双人 · 出怪数含双人系数', Math.abs(duo.spawnPlanned - duoExpect) <= 1,
      '实际=' + duo.spawnPlanned + ' 期望≈' + duoExpect);

    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
