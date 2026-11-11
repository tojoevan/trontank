/* ==========================================================
   验证脚本公共库
   ----------------------------------------------------------
   目标：换一台机器也能跑，不依赖本机硬编码路径。

   可用环境变量：
     BASE_URL          默认 http://127.0.0.1:49460/index.html?debug
     PLAYWRIGHT_MODULE 指定 playwright 模块路径
     CHROME_PATH       指定 Chromium/Chrome 可执行文件
   ========================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');

/* ---------- Playwright 模块定位 ---------- */
function resolvePlaywright() {
  const tried = [];

  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) { candidates.push(process.env.PLAYWRIGHT_MODULE); }
  candidates.push('playwright');
  candidates.push(path.join(__dirname, '..', 'node_modules', 'playwright'));

  /* WorkBuddy 内置的 node 环境带了一份 playwright（版本号在路径里，需扫） */
  const wbRoot = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  if (fs.existsSync(wbRoot)) {
    for (const v of fs.readdirSync(wbRoot)) {
      candidates.push(path.join(wbRoot, v, 'lib', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright'));
    }
  }

  for (const c of candidates) {
    try {
      const mod = require(c);
      if (mod && mod.chromium) { return mod; }
    } catch (e) {
      tried.push(c);
    }
  }
  throw new Error(
    '找不到 playwright 模块。试过：\n  ' + tried.join('\n  ') +
    '\n请 npm i -D playwright 或设置 PLAYWRIGHT_MODULE'
  );
}

/* ---------- 浏览器可执行文件定位 ---------- */
function resolveChrome(pw) {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) { return process.env.CHROME_PATH; }
    throw new Error('CHROME_PATH 指向的文件不存在: ' + process.env.CHROME_PATH);
  }

  /* playwright 自己注册的路径（注意：可能指向尚未下载的版本，必须验存在） */
  try {
    const p = pw.chromium.executablePath();
    if (p && fs.existsSync(p)) { return p; }
  } catch (e) { /* 忽略，继续找 */ }

  /* 扫 ms-playwright 缓存，取版本号最大的 */
  const cacheRoots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),   // macOS
    path.join(os.homedir(), '.cache', 'ms-playwright'),             // Linux
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')    // Windows
  ];
  const suffixes = [
    path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join('chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join('chrome-linux', 'chrome'),
    path.join('chrome-win', 'chrome.exe')
  ];
  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) { continue; }
    const dirs = fs.readdirSync(root)
      .filter(d => d.startsWith('chromium-'))
      .sort((a, b) => parseInt(b.slice(9), 10) - parseInt(a.slice(9), 10));
    for (const d of dirs) {
      for (const s of suffixes) {
        const full = path.join(root, d, s);
        if (fs.existsSync(full)) { return full; }
      }
    }
  }

  /* 最后退回系统安装的 Chrome */
  const sys = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  for (const s of sys) {
    if (fs.existsSync(s)) { return s; }
  }

  throw new Error('找不到浏览器可执行文件。请 npx playwright install chromium 或设置 CHROME_PATH');
}

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:49460/index.html?debug';

/* ---------- 统一启动 ---------- */
async function launch(opts) {
  const o = opts || {};
  const pw = resolvePlaywright();
  const exe = resolveChrome(pw);
  const browser = await pw.chromium.launch({
    headless: o.headless !== false,
    executablePath: exe
  });
  const page = await browser.newPage({
    viewport: o.viewport || { width: 1280, height: 760 }
  });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/404|cdn-cgi|favicon/.test(m.text())) {
      errors.push('CONSOLE: ' + m.text().slice(0, 160));
    }
  });

  return { browser, page, errors, pw, exe };
}

/* ---------- 打开并进入单人/双人 ---------- */
async function openGame(page, mode) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => !!window.__bqs, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('[data-action="' + (mode || 'solo') + '"]');
  await page.waitForTimeout(700);
  return page.evaluate(() => window.__bqs.current());
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 轮询直到条件成立 ---------- */
async function waitUntil(page, fn, timeout, label) {
  const t0 = Date.now();
  const limit = timeout || 20000;
  while (Date.now() - t0 < limit) {
    if (await page.evaluate(fn)) { return true; }
    await sleep(250);
  }
  throw new Error('等待超时' + (label ? '（' + label + '）' : '') + ': ' + limit + 'ms');
}

/* ---------- 结果汇报 ---------- */
function createReporter(name) {
  const rows = [];
  let failed = 0;

  const api = {
    info(msg) {
      console.log('  · ' + msg);
    },
    check(label, ok, detail) {
      const pass = !!ok;
      if (!pass) { failed++; }
      rows.push({ label, pass });
      console.log('  ' + (pass ? '✔' : '✘') + ' ' + label + (detail ? '  [' + detail + ']' : ''));
      return pass;
    },
    /* 宽松断言：只在失败时占一行，避免刷屏 */
    eq(label, actual, expected) {
      return api.check(label, actual === expected, '实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected));
    },
    fail(label, err) {
      failed++;
      rows.push({ label, pass: false });
      console.log('  ✘ ' + label + '  [' + (err && err.message ? err.message.slice(0, 200) : err) + ']');
    },
    finish() {
      const total = rows.length;
      const passed = total - failed;
      console.log('');
      if (failed === 0) {
        console.log('结果: ' + name + ' ' + passed + '/' + total + ' 通过');
        process.exitCode = 0;
      } else {
        console.log('结果: ' + name + ' ' + passed + '/' + total + ' 通过，' + failed + ' 项失败');
        process.exitCode = 1;
      }
      return failed === 0;
    }
  };
  return api;
}

/* ---------- 脚本外壳：统一捕获异常与收尾 ---------- */
function run(name, fn) {
  console.log('');
  console.log('=== ' + name + ' ===');
  const t = createReporter(name);
  fn(t)
    .catch(err => {
      t.fail('脚本异常', err);
    })
    .then(() => {
      t.finish();
    });
}

module.exports = { launch, openGame, waitUntil, sleep, createReporter, run, BASE_URL, resolveChrome, resolvePlaywright };
