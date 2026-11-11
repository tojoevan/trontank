/* ==========================================================
   lint：单文件项目的静态检查
   ----------------------------------------------------------
   没有构建步骤，所以这里承担 CI 里「编译」的角色：
     1. 所有内联 <script> 块语法正确（new Function 解析）
     2. HTML 骨架完整（<html>/</html>、canvas、关键容器）
     3. 关键函数没被误删（改动时最容易「删掉函数头」）
     4. 调试接口没有泄漏到非 debug 路径
   ========================================================== */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

let failed = 0;
function check(label, ok, detail) {
  if (!ok) { failed++; }
  console.log('  ' + (ok ? '✔' : '✘') + ' ' + label + (detail ? '  [' + detail + ']' : ''));
}

console.log('');
console.log('=== lint 静态检查 ===');

/* ---------- 1. 内联脚本语法 ---------- */
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0, syntaxError = null;
while ((m = re.exec(html))) {
  n++;
  try {
    new Function(m[1]);
  } catch (e) {
    syntaxError = '第 ' + n + ' 个脚本块: ' + e.message;
    break;
  }
}
check('内联脚本语法正确', syntaxError === null, syntaxError || (n + ' 个脚本块'));
check('存在内联脚本', n > 0, n + ' 个');

/* ---------- 2. HTML 骨架 ---------- */
check('HTML 骨架完整', /<html[\s>]/i.test(html) && /<\/html>\s*$/i.test(html));
check('canvas#game 存在', /<canvas[^>]*id="game"/.test(html));
check('stage 容器存在', /id="stage"/.test(html));
check('viewport meta 存在', /name="viewport"/.test(html));
check('没有残留的合并冲突标记', !/^(<<<<<<<|=======|>>>>>>>)/m.test(html));

/* ---------- 3. 关键函数在不在 ---------- */
const REQUIRED = [
  'function drawHUD',
  'function drawPlayerCard',
  'function updatePlayer',
  'function buildArena',
  'function confineToArena',
  'function arenaDist',
  'function buildObstacles',
  'function terrainForWave',
  'function shuffleTerrainPlan',
  'function killEnemy',
  'function drawMinimap',
  'function setupCanvas'
];
const missing = REQUIRED.filter(fn => html.indexOf(fn) === -1);
check('关键函数齐全', missing.length === 0, missing.join(', ') || REQUIRED.length + ' 个');

/* 函数定义与调用数量：函数头被误删时，调用点还在但定义没了 */
const defCounts = {};
for (const fn of REQUIRED) {
  const name = fn.replace('function ', '');
  const defs = (html.match(new RegExp('function\\s+' + name + '\\s*\\(', 'g')) || []).length;
  defCounts[name] = defs;
}
const dup = Object.keys(defCounts).filter(k => defCounts[k] > 1);
check('没有重复定义（同名声明的函数会互相覆盖）', dup.length === 0,
  dup.length ? dup.join(', ') : '全部唯一');

/* ---------- 4. 调试接口隔离 ---------- */
const debugIdx = html.indexOf('window.__bqs = {');
if (debugIdx !== -1) {
  /* 往前找最近的 if，必须带 debug 判断 */
  const before = html.slice(Math.max(0, debugIdx - 400), debugIdx);
  check('调试接口被 ?debug 包裹', /indexOf\(['"]debug['"]\)|location\.search/.test(before));
} else {
  check('调试接口存在', false, 'window.__bqs 未找到');
}

/* ---------- 5. 体积 ---------- */
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
const gz = require('zlib').gzipSync(Buffer.from(html)).length;
check('单文件体积 < 600KB', Buffer.byteLength(html) < 600 * 1024, kb + 'KB（gzip ' + (gz / 1024).toFixed(1) + 'KB）');

console.log('');
if (failed === 0) {
  console.log('结果: lint 全部通过');
  process.exitCode = 0;
} else {
  console.log('结果: lint ' + failed + ' 项失败');
  process.exitCode = 1;
}
