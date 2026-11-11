#!/usr/bin/env bash
# ==========================================================
# 一条命令跑完回归验证
# ----------------------------------------------------------
#   ./tools/verify.sh              # 全量（lint + 冒烟 + 连携 + 边界 + 顺序 + 密度 + 性能）
#   ./tools/verify.sh --fast       # 只跑 lint + 冒烟（改小东西时用）
#   ./tools/verify.sh smoke order  # 只跑指定几项
#
# 本地服务没起时会自动拉起一个静态服务器，跑完自动关。
# 环境变量：PORT / BASE_URL / CHROME_PATH / PLAYWRIGHT_MODULE
# ==========================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PORT="${PORT:-49460}"
export BASE_URL="${BASE_URL:-http://127.0.0.1:$PORT/index.html?debug}"

ALL=(smoke duo-rescue arena-edge order density perf)

# ---------- 参数解析 ----------
SUITES=()
MODE="full"
for arg in "$@"; do
  case "$arg" in
    --fast) MODE="fast" ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) SUITES+=("$arg") ;;
  esac
done

if [ "$MODE" = "fast" ] && [ ${#SUITES[@]} -eq 0 ]; then
  SUITES=(smoke)
fi
if [ ${#SUITES[@]} -eq 0 ]; then
  SUITES=("${ALL[@]}")
fi

# ---------- 服务自检 ----------
SERVER_PID=""
if ! curl -s -o /dev/null --max-time 2 "$BASE_URL"; then
  echo "本地服务未运行，正在 $PORT 端口拉起静态服务器..."
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 20); do
    sleep 0.3
    if curl -s -o /dev/null --max-time 1 "$BASE_URL"; then break; fi
  done
  if ! curl -s -o /dev/null --max-time 2 "$BASE_URL"; then
    echo "无法启动本地服务器，请手动运行： python3 -m http.server $PORT"
    exit 1
  fi
  echo "服务已就绪（PID $SERVER_PID）"
  trap '[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null' EXIT
fi

# ---------- 逐项执行 ----------
START=$(date +%s)
FAILED=()

echo ""
echo "################ lint ################"
if ! node tools/lint.js; then
  FAILED+=("lint")
fi

for s in "${SUITES[@]}"; do
  if [ ! -f "tools/$s.js" ]; then
    echo ""
    echo "跳过未知用例: $s（可用：${ALL[*]}）"
    continue
  fi
  echo ""
  echo "################ $s ################"
  if ! node "tools/$s.js"; then
    FAILED+=("$s")
  fi
done

# ---------- 汇总 ----------
END=$(date +%s)
echo ""
echo "=========================================="
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "全部通过 · 耗时 $((END - START))s"
  exit 0
else
  echo "失败 ${#FAILED[@]} 项: ${FAILED[*]} · 耗时 $((END - START))s"
  exit 1
fi
