#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_PATH="${SCRIPT_DIR}/docker-compose.generated.yml"

DEFAULT_SYNC_IMAGE="crpi-euihr92xl17baj83.cn-shenzhen.personal.cr.aliyuncs.com/dpeak/listentogether-syncserver:latest"
DEFAULT_CONTAINER_NAME="listentogether-syncserver"
DEFAULT_BIND_ADDRESS="127.0.0.1"
DEFAULT_HOST_PORT="8787"
DEFAULT_ROOM_EMPTY_TTL_MS="1800000"
DEFAULT_MEMBER_HEARTBEAT_TIMEOUT_MS="5000"
DEFAULT_MAX_ROOM_MEMBERS="8"
DEFAULT_MAX_QUEUE_ITEMS="500"
DEFAULT_MAX_COMMANDS_PER_WINDOW="20"
DEFAULT_RATE_LIMIT_WINDOW_MS="1000"
DEFAULT_MAX_ROOM_OPS_PER_WINDOW="6"
DEFAULT_ROOM_OPS_RATE_LIMIT_WINDOW_MS="10000"
DEFAULT_MAX_MESSAGE_BYTES="65536"
DEFAULT_CLEANUP_INTERVAL_MS="1000"

SYNC_IMAGE="${DEFAULT_SYNC_IMAGE}"
CONTAINER_NAME="${DEFAULT_CONTAINER_NAME}"
BIND_ADDRESS="${DEFAULT_BIND_ADDRESS}"
HOST_PORT="${DEFAULT_HOST_PORT}"
ROOM_EMPTY_TTL_MS="${DEFAULT_ROOM_EMPTY_TTL_MS}"
MEMBER_HEARTBEAT_TIMEOUT_MS="${DEFAULT_MEMBER_HEARTBEAT_TIMEOUT_MS}"
MAX_ROOM_MEMBERS="${DEFAULT_MAX_ROOM_MEMBERS}"
MAX_QUEUE_ITEMS="${DEFAULT_MAX_QUEUE_ITEMS}"
MAX_COMMANDS_PER_WINDOW="${DEFAULT_MAX_COMMANDS_PER_WINDOW}"
RATE_LIMIT_WINDOW_MS="${DEFAULT_RATE_LIMIT_WINDOW_MS}"
MAX_ROOM_OPS_PER_WINDOW="${DEFAULT_MAX_ROOM_OPS_PER_WINDOW}"
ROOM_OPS_RATE_LIMIT_WINDOW_MS="${DEFAULT_ROOM_OPS_RATE_LIMIT_WINDOW_MS}"
MAX_MESSAGE_BYTES="${DEFAULT_MAX_MESSAGE_BYTES}"
CLEANUP_INTERVAL_MS="${DEFAULT_CLEANUP_INTERVAL_MS}"

print_header() {
  echo "========================================"
  echo " ListenTogether SyncServer 安装器"
  echo "========================================"
  echo
  echo "说明:"
  echo "- 容器内部端口固定为 8787。"
  echo "- 这里配置的是宿主机映射端口，不是修改容器内部端口。"
  echo "- 默认绑定地址是 127.0.0.1，适合后续交给 Nginx 反代。"
  echo
}

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少命令: ${command_name}"
    echo "请先安装: ${install_hint}"
    exit 1
  fi
}

require_docker_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    echo "缺少 Docker Compose 插件: docker compose"
    echo "请先安装 Docker Compose v2。"
    exit 1
  fi
}

prompt_value() {
  local prompt_text="$1"
  local default_value="$2"
  local result=""
  read -r -p "${prompt_text} [默认: ${default_value}]: " result
  if [[ -z "${result}" ]]; then
    result="${default_value}"
  fi
  printf '%s' "${result}"
}

validate_port() {
  local port_value="$1"
  if ! [[ "${port_value}" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if (( port_value < 1 || port_value > 65535 )); then
    return 1
  fi
}

validate_nonempty() {
  local value="$1"
  [[ -n "${value}" ]]
}

validate_positive_integer() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]+$ ]] && (( value > 0 ))
}

load_interactive_values() {
  echo "基础配置"
  CONTAINER_NAME="$(prompt_value "Docker 容器名" "${DEFAULT_CONTAINER_NAME}")"
  SYNC_IMAGE="$(prompt_value "Docker 镜像地址" "${DEFAULT_SYNC_IMAGE}")"
  BIND_ADDRESS="$(prompt_value "宿主机绑定地址" "${DEFAULT_BIND_ADDRESS}")"

  while true; do
    HOST_PORT="$(prompt_value "宿主机映射端口" "${DEFAULT_HOST_PORT}")"
    if validate_port "${HOST_PORT}"; then
      break
    fi
    echo "端口无效，请输入 1 到 65535 之间的数字。"
  done

  echo
  echo "高级参数"
  ROOM_EMPTY_TTL_MS="$(prompt_value "空房间保留时长（毫秒）" "${DEFAULT_ROOM_EMPTY_TTL_MS}")"
  MEMBER_HEARTBEAT_TIMEOUT_MS="$(prompt_value "成员心跳超时（毫秒）" "${DEFAULT_MEMBER_HEARTBEAT_TIMEOUT_MS}")"
  MAX_ROOM_MEMBERS="$(prompt_value "单房间最大成员数" "${DEFAULT_MAX_ROOM_MEMBERS}")"
  MAX_QUEUE_ITEMS="$(prompt_value "单房间最大队列长度" "${DEFAULT_MAX_QUEUE_ITEMS}")"
  MAX_COMMANDS_PER_WINDOW="$(prompt_value "命令限流窗口内最大命令数" "${DEFAULT_MAX_COMMANDS_PER_WINDOW}")"
  RATE_LIMIT_WINDOW_MS="$(prompt_value "命令限流窗口（毫秒）" "${DEFAULT_RATE_LIMIT_WINDOW_MS}")"
  MAX_ROOM_OPS_PER_WINDOW="$(prompt_value "建房/加房窗口内最大操作数" "${DEFAULT_MAX_ROOM_OPS_PER_WINDOW}")"
  ROOM_OPS_RATE_LIMIT_WINDOW_MS="$(prompt_value "建房/加房限流窗口（毫秒）" "${DEFAULT_ROOM_OPS_RATE_LIMIT_WINDOW_MS}")"
  MAX_MESSAGE_BYTES="$(prompt_value "单条消息最大字节数" "${DEFAULT_MAX_MESSAGE_BYTES}")"
  CLEANUP_INTERVAL_MS="$(prompt_value "清理轮询间隔（毫秒）" "${DEFAULT_CLEANUP_INTERVAL_MS}")"
}

validate_values() {
  if ! validate_nonempty "${CONTAINER_NAME}"; then
    echo "容器名不能为空。"
    exit 1
  fi

  if ! validate_nonempty "${SYNC_IMAGE}"; then
    echo "镜像地址不能为空。"
    exit 1
  fi

  for value_name in \
    ROOM_EMPTY_TTL_MS \
    MEMBER_HEARTBEAT_TIMEOUT_MS \
    MAX_ROOM_MEMBERS \
    MAX_QUEUE_ITEMS \
    MAX_COMMANDS_PER_WINDOW \
    RATE_LIMIT_WINDOW_MS \
    MAX_ROOM_OPS_PER_WINDOW \
    ROOM_OPS_RATE_LIMIT_WINDOW_MS \
    MAX_MESSAGE_BYTES \
    CLEANUP_INTERVAL_MS
  do
    if ! validate_positive_integer "${!value_name}"; then
      echo "参数 ${value_name} 无效: ${!value_name}"
      echo "它必须是正整数。"
      exit 1
    fi
  done
}

render_compose_file() {
  cat > "${OUTPUT_PATH}" <<EOF
services:
  listentogether-syncserver:
    image: ${SYNC_IMAGE}
    container_name: ${CONTAINER_NAME}
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 8787
      ROOM_EMPTY_TTL_MS: ${ROOM_EMPTY_TTL_MS}
      MEMBER_HEARTBEAT_TIMEOUT_MS: ${MEMBER_HEARTBEAT_TIMEOUT_MS}
      MAX_ROOM_MEMBERS: ${MAX_ROOM_MEMBERS}
      MAX_QUEUE_ITEMS: ${MAX_QUEUE_ITEMS}
      MAX_COMMANDS_PER_WINDOW: ${MAX_COMMANDS_PER_WINDOW}
      RATE_LIMIT_WINDOW_MS: ${RATE_LIMIT_WINDOW_MS}
      MAX_ROOM_OPS_PER_WINDOW: ${MAX_ROOM_OPS_PER_WINDOW}
      ROOM_OPS_RATE_LIMIT_WINDOW_MS: ${ROOM_OPS_RATE_LIMIT_WINDOW_MS}
      MAX_MESSAGE_BYTES: ${MAX_MESSAGE_BYTES}
      CLEANUP_INTERVAL_MS: ${CLEANUP_INTERVAL_MS}
    ports:
      - "${BIND_ADDRESS}:${HOST_PORT}:8787"
EOF
}

show_summary() {
  echo
  echo "部署摘要"
  echo "- 镜像: ${SYNC_IMAGE}"
  echo "- 容器名: ${CONTAINER_NAME}"
  echo "- 宿主机绑定: ${BIND_ADDRESS}:${HOST_PORT}"
  echo "- 容器内部端口: 8787"
  echo "- 生成文件: ${OUTPUT_PATH}"
  echo
}

confirm_and_deploy() {
  local answer=""
  read -r -p "确认开始部署? [Y/n]: " answer
  answer="${answer:-Y}"
  if [[ ! "${answer}" =~ ^[Yy]$ ]]; then
    echo "已取消部署。生成的 compose 文件保留在:"
    echo "${OUTPUT_PATH}"
    exit 0
  fi

  docker compose -f "${OUTPUT_PATH}" pull
  docker compose -f "${OUTPUT_PATH}" up -d
  docker compose -f "${OUTPUT_PATH}" ps

  echo
  echo "部署完成。"
  echo "本地 WebSocket 地址: ws://${BIND_ADDRESS}:${HOST_PORT}/ws"
  echo "如果需要公网访问，建议使用 Nginx 将 /ws 反代到这个宿主机端口。"
}

main() {
  print_header
  require_command "docker" "Docker Engine or Docker Desktop"
  require_docker_compose
  load_interactive_values
  validate_values
  render_compose_file
  show_summary
  confirm_and_deploy
}

main "$@"
