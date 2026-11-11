/* ==========================================================
   order：地形顺序与确定性
   ----------------------------------------------------------
   守的是这条设计约定：
     · 休闲 / 标准 —— 固定顺序，同一关每局完全一样（种子固定）
     · 挑战       —— 每局顺序和布局都不同（种子带 runSeed）

   顺带验证「同一局内重建结果一致」：同波次连读两次，形状必须相同，
   否则窗口缩放会导致地形抖动。
   ========================================================== */
const { launch, run, sleep, BASE_URL } = require('./lib');

const WAVES = [1, 3, 7, 9];

async function snapshot(page, diff) {
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__bqs, null, { timeout: 15000 });
  await sleep(250);
  await page.click('[data-diff="' + diff + '"]');
  await page.click('[data-action="solo"]');
  await sleep(650);

  const rows = [];
  for (const n of WAVES) {
    await page.evaluate(w => window.__bqs.startWave(w), n);
    await sleep(300);
    const c = await page.evaluate(() => window.__bqs.current());
    rows.push({
      wave: n,
      terrain: c.terrain,
      sides: c.arenaSides,
      /* 轮廓顶点是判断「每局是否真的不同」最直接的指纹 */
      fingerprint: c.arena.map(p => p.join(',')).join(';')
    });
  }
  return rows;
}

const same = (a, b) => JSON.stringify(a.map(r => [r.terrain, r.fingerprint])) ===
                       JSON.stringify(b.map(r => [r.terrain, r.fingerprint]));

run('order 地形顺序与确定性', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    /* 休闲：两局必须一致 */
    const easyA = await snapshot(page, 'easy');
    const easyB = await snapshot(page, 'easy');
    t.check('休闲 · 两局地形与轮廓完全一致', same(easyA, easyB),
      easyA.map(r => r.wave + ':' + r.terrain).join(' '));

    /* 标准：两局必须一致 */
    const normalA = await snapshot(page, 'normal');
    const normalB = await snapshot(page, 'normal');
    t.check('标准 · 两局地形与轮廓完全一致', same(normalA, normalB),
      normalA.map(r => r.wave + ':' + r.terrain).join(' '));

    /* 休闲与标准都是固定顺序，序列应当相同 */
    t.check('休闲与标准走同一套固定序列', same(easyA, normalA));

    /* 挑战：两局必须不同 */
    const hardA = await snapshot(page, 'hard');
    const hardB = await snapshot(page, 'hard');
    t.check('挑战 · 两局顺序或布局不同', !same(hardA, hardB),
      'A=' + hardA.map(r => r.terrain).join(',') + ' | B=' + hardB.map(r => r.terrain).join(','));

    /* 同局内确定性：同一波次读两次必须一样（防止 resize/重建导致抖动） */
    await page.evaluate(() => window.__bqs.startWave(5));
    await sleep(300);
    const w5a = await page.evaluate(() => window.__bqs.current());
    await page.evaluate(() => window.__bqs.startWave(5));
    await sleep(300);
    const w5b = await page.evaluate(() => window.__bqs.current());
    t.check('同局内 · 同波次重建结果一致',
      w5a.arenaSides === w5b.arenaSides &&
      JSON.stringify(w5a.arena) === JSON.stringify(w5b.arena),
      w5a.arenaSides + ' 边 vs ' + w5b.arenaSides + ' 边');

    /* 每关都该是多边形，不是退化矩形 */
    const allWaves = [easyA, normalA, hardA, hardB];
    let minSides = 99;
    for (const set of allWaves) {
      for (const r of set) { if (r.sides < minSides) { minSides = r.sides; } }
    }
    t.check('所有采样关卡都是多边形边界', minSides >= 5, '最少 ' + minSides + ' 边');

    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    t.fail('流程异常', e);
  } finally {
    await browser.close();
  }
});
