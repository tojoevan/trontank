/* ==========================================================
   duo-rescue：双人连携（倒地救援 + 背靠背护盾）
   ----------------------------------------------------------
   为什么要单独一套：救援和护盾是双人玩法的核心，但此前只是
   「代码里写着」，没有任何断言。而且这两件事靠「站着挨打」
   根本构造不出稳定局面——实测两次：一次两人一起倒直接结算，
   一次才算凑出「一人倒地一人站立」。

   所以改用调试接口的 hurt() 注入伤害（走的是真实 hurtPlayer，
   护盾减伤等逻辑照常生效），把随机性从用例里彻底去掉。

   守的四件事：
     1. 护盾只在两人靠近时生效，且伤害恰好 ×0.75
     2. 队友不在范围内时救援进度不涨
     3. 中途离开，救援进度会回退（不会靠反复路过攒满）
     4. 停留满 2 秒真正复活，且按 50% 血量起身
     5. 两人都倒地 → 直接结算，不会卡在「都倒着但游戏继续」
   ========================================================== */
const { launch, openGame, run, sleep } = require('./lib');

const cur = page => page.evaluate(() => window.__bqs.current());
const gap = c => Math.hypot(c.players[0].x - c.players[1].x, c.players[0].y - c.players[1].y);

/* 注入伤害并立刻读血量：同一次 evaluate 里完成，
   中间不会插入敌人的伤害，测量才不会被外部干扰污染 */
async function hitAtomic(page, idx, dmg) {
  return page.evaluate((args) => {
    const before = window.__bqs.current().players[args.idx].hp;
    window.__bqs.hurt(args.idx, args.dmg);
    const after = window.__bqs.current().players[args.idx];
    return { before, after: after.hp, downed: after.downed, alive: after.alive };
  }, { idx, dmg });
}

/* 用 2P 的方向键走到目标点，满足条件就停 */
async function walk(page, goalOf, ok, maxMs) {
  const t0 = Date.now();
  let c = await cur(page);
  while (Date.now() - t0 < maxMs) {
    if (ok(c) || c.state !== 'playing') { return c; }
    const me = c.players[1];
    const g = goalOf(c);
    const dx = g.x - me.x;
    const dy = g.y - me.y;
    const k = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
      : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
    await page.keyboard.down(k);
    await sleep(130);
    await page.keyboard.up(k);
    c = await cur(page);
  }
  return c;
}

const approach = (page, maxMs) => walk(page, c => ({ x: c.players[0].x, y: c.players[0].y }), c => gap(c) < 70, maxMs);

/* 朝远离队友的方向走：目标点取「队友位置再往外推 3 倍」，走出护盾/救援范围 */
const retreat = (page, maxMs) => walk(page,
  c => {
    const a = c.players[0], b = c.players[1];
    return { x: a.x + (b.x - a.x) * 3, y: a.y + (b.y - a.y) * 3 };
  },
  c => gap(c) > 170, maxMs);

run('duo-rescue 双人连携（救援 + 护盾）', async (t) => {
  const { browser, page, errors } = await launch();
  try {
    let c = await openGame(page, 'duo');
    t.eq('连携 · 进入双人', c.state, 'playing');
    t.check('连携 · 两人都在场', c.players[0].alive && c.players[1].alive);

    /* ---------- 1. 护盾：分开时不生效，吃满伤害 ---------- */
    c = await retreat(page, 9000);
    t.check('护盾 · 拉开距离后失效', c.duoShield === false, '距离=' + Math.round(gap(c)));

    const far = await hitAtomic(page, 0, 20);
    t.eq('护盾 · 无效时吃满 20 点', far.before - far.after, 20);

    if (far.after <= 0) {
      t.fail('护盾 · 血量不足以继续测量', 'P1 已被敌人打到 ' + far.after + '，本局作废');
      throw new Error('abort');
    }

    /* ---------- 2. 护盾：靠近后减伤 25% ---------- */
    c = await approach(page, 9000);
    t.check('护盾 · 靠近后生效', c.duoShield === true, '距离=' + Math.round(gap(c)));

    const near = await hitAtomic(page, 0, 20);
    t.eq('护盾 · 减伤 25%（20 → 15）', near.before - near.after, 15);

    if (near.after <= 0) {
      t.fail('连携 · 血量不足以继续测量', 'P1 只剩 ' + near.after + '，本局作废');
      throw new Error('abort');
    }

    /* ---------- 3. 倒地：注入致命伤害后应「倒地」而不是「阵亡」 ---------- */
    c = await retreat(page, 9000);          // 先走开，避免刚倒就被救起
    const down = await hitAtomic(page, 0, 9999);
    t.check('倒地 · 血量归零', down.after === 0, 'hp=' + down.after);
    t.check('倒地 · 队友还站着时进入待救援', down.downed === true && down.alive === true,
      'downed=' + down.downed + ' alive=' + down.alive);

    await sleep(900);
    c = await cur(page);
    t.eq('救援 · 队友在范围外进度不涨', c.players[0].rescueT, 0);
    t.check('救援 · 范围外不会自己爬起来', c.players[0].downed === true);

    /* ---------- 4. 救援进度：靠近会累计，离开会回退 ---------- */
    c = await approach(page, 9000);
    await sleep(700);
    const mid = await cur(page);
    const t1 = mid.players[0].rescueT;
    t.check('救援 · 靠近后进度开始累计', t1 > 0.3, 'rescueT=' + t1 + 's');
    t.check('救援 · 不足 2 秒不会立刻起身', mid.players[0].downed === true, 'rescueT=' + t1 + 's');

    c = await retreat(page, 9000);
    await sleep(900);
    const after = await cur(page);
    t.check('救援 · 中途离开进度回退', after.players[0].rescueT < t1,
      t1 + 's → ' + after.players[0].rescueT + 's');
    t.check('救援 · 回退期间仍未起身', after.players[0].downed === true);

    /* ---------- 5. 救起：停留满 2 秒，按 50% 血量复活 ---------- */
    await approach(page, 9000);
    const deadline = Date.now() + 6000;
    let revived = null;
    while (Date.now() < deadline) {
      await sleep(200);
      const s = await cur(page);
      if (!s.players[0].downed) { revived = s; break; }
    }
    if (revived) {
      const p1 = revived.players[0];
      t.check('救援 · 停留满 2 秒成功救起', true, 'rescueT 达到阈值');
      t.eq('救援 · 按 50% 血量复活', p1.hp, Math.round(p1.maxHp * 0.5));
      t.check('救援 · 复活后恢复站立', p1.alive && !p1.downed, 'hp=' + p1.hp + '/' + p1.maxHp);
    } else {
      t.check('救援 · 停留满 2 秒成功救起', false, '6 秒内未复活');
    }

    /* 复活后有 1.8 秒无敌，等过去再做双倒 */
    await sleep(2000);

    /* ---------- 6. 两人都倒 → 直接结算 ---------- */
    const d1 = await hitAtomic(page, 0, 9999);
    t.check('双倒 · 先倒一个仍可继续', d1.downed === true, 'hp=' + d1.after);
    await page.evaluate(() => window.__bqs.hurt(1, 9999));
    await sleep(600);
    const over = await cur(page);
    t.eq('双倒 · 两人都倒直接结算', over.state, 'result');

    /* ---------------- 控制台 ---------------- */
    t.check('控制台无报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    if (e.message !== 'abort') { t.fail('流程异常', e); }
  } finally {
    await browser.close();
  }
});
