#!/usr/bin/env bash
# 命题组服务的启停。
#
# 为什么要有这个脚本：手搓 `pkill -f bin.js` 会**把自己这条命令也匹配掉**
# （命令行里含同样的字符串），于是杀掉自己的 shell，看起来"重启成功了"，
# 实际旧进程还在占端口、新进程 EADDRINUSE 静默退出——你看到的是旧构建的结果。
# 所以这里：按 PID 文件停、启动前**先确认端口真的空了**、启动后确认在监听。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${EXAMHARNESS_PORT:-8787}"
PID_FILE="data/serve.pid"
LOG_FILE="data/serve.log"
mkdir -p data

stop() {
  if [ -f "$PID_FILE" ]; then
    local pid; pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"; sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" || true
      echo "已停止 pid=$pid"
    fi
    rm -f "$PID_FILE"
  else
    echo "没有 PID 文件，跳过停止"
  fi
}

wait_free() {
  for _ in $(seq 1 20); do
    if ! (ss -ltn 2>/dev/null | grep -q ":$PORT "); then return 0; fi
    sleep 0.5
  done
  echo "端口 $PORT 仍被占用——先查清是谁在用（ss -ltnp），别硬起" >&2
  return 1
}

case "${1:-start}" in
  start)
    if [ -f "$PID_FILE" ]; then stop; fi
    wait_free
    nohup node bin.js > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 2
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "启动失败，日志尾部：" >&2; tail -5 "$LOG_FILE" >&2; exit 1
    fi
    ss -ltn 2>/dev/null | grep -q ":$PORT " && echo "已启动 pid=$(cat "$PID_FILE")，端口 $PORT，日志 $LOG_FILE" \
      || { echo "进程活着但没在监听 $PORT" >&2; exit 1; }
    ;;
  stop) stop ;;
  restart) "$0" stop; "$0" start ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "运行中 pid=$(cat "$PID_FILE")"
    else
      echo "未运行"
    fi
    ;;
  *) echo "用法: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
