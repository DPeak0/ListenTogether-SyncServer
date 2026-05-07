#!/usr/bin/env bash

set -euo pipefail

ALIYUN_SYNC_IMAGE="crpi-euihr92xl17baj83.cn-shenzhen.personal.cr.aliyuncs.com/dpeak/listentogether-syncserver:0.1.0"
GITHUB_SYNC_IMAGE="ghcr.io/dpeak0/listentogether-syncserver:latest"

DEFAULT_CONTAINER_NAME="listentogether-syncserver"
DEFAULT_BIND_ADDRESS="127.0.0.1"
DEFAULT_HOST_PORT="8787"
DEFAULT_ROOM_EMPTY_TTL_MS="1800000"
DEFAULT_MEMBER_HEARTBEAT_TIMEOUT_MS="5000"
DEFAULT_MAX_ROOM_MEMBERS="10"
DEFAULT_MAX_QUEUE_ITEMS="500"
DEFAULT_MAX_COMMANDS_PER_WINDOW="20"
DEFAULT_RATE_LIMIT_WINDOW_MS="1000"
DEFAULT_MAX_ROOM_OPS_PER_WINDOW="6"
DEFAULT_ROOM_OPS_RATE_LIMIT_WINDOW_MS="10000"
DEFAULT_MAX_MESSAGE_BYTES="65536"
DEFAULT_CLEANUP_INTERVAL_MS="1000"

SYNC_IMAGE="${ALIYUN_SYNC_IMAGE}"
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
DOCKER_CMD=("docker")

print_header() {
  echo "=============================================="
  echo " ListenTogether SyncServer 一键安装脚本"
  echo "=============================================="
}

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少命令：${command_name}"
    echo "请先安装：${install_hint}"
    exit 1
  fi
}

setup_docker_command() {
  if [[ "${EUID}" -eq 0 ]]; then
    DOCKER_CMD=("docker")
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    DOCKER_CMD=("sudo" "docker")
    return
  fi

  echo "当前用户不是 root，且系统未安装 sudo。"
  echo "请先安装 sudo，或切换到 root 后重新执行脚本。"
  exit 1
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

validate_positive_integer() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]+$ ]] && (( value > 0 ))
}

select_image_source() {
  local choice=""
  echo "请选择 Docker 镜像源（默认选择阿里云镜像源）："
  echo "1) 阿里云镜像源：国内网络环境"
  echo "2) Github 镜像源：海外网络环境"
  read -r -p "请输入 1 或 2，回车使用默认值 1: " choice

  case "${choice:-1}" in
    1)
      SYNC_IMAGE="${ALIYUN_SYNC_IMAGE}"
      ;;
    2)
      SYNC_IMAGE="${GITHUB_SYNC_IMAGE}"
      ;;
    *)
      echo "输入无效，已使用默认值 1（阿里云镜像源）。"
      SYNC_IMAGE="${ALIYUN_SYNC_IMAGE}"
      ;;
  esac
}

load_interactive_values() {
  select_image_source

  echo
  while true; do
    BIND_ADDRESS="$(prompt_value "请设置宿主机绑定地址" "${DEFAULT_BIND_ADDRESS}")"
    if [[ -n "${BIND_ADDRESS}" ]]; then
      break
    fi
    echo "绑定地址不能为空。"
  done

  echo
  while true; do
    HOST_PORT="$(prompt_value "请设置宿主机映射端口" "${DEFAULT_HOST_PORT}")"
    if validate_port "${HOST_PORT}"; then
      break
    fi
    echo "端口无效，请输入 1 到 65535 之间的数字。"
  done

  echo
  while true; do
    MAX_ROOM_MEMBERS="$(prompt_value "请设置房间最大人数限制" "${DEFAULT_MAX_ROOM_MEMBERS}")"
    if validate_positive_integer "${MAX_ROOM_MEMBERS}"; then
      break
    fi
    echo "人数限制无效，请输入正整数。"
  done
}

show_summary() {
  echo
  echo "部署摘要："
  echo "- 镜像地址：${SYNC_IMAGE}"
  echo "- 容器名：${CONTAINER_NAME}"
  echo "- 宿主机绑定地址：${BIND_ADDRESS}"
  echo "- 宿主机映射端口：${HOST_PORT}"
  echo "- 容器内部端口：8787"
  echo "- 房间最大人数限制：${MAX_ROOM_MEMBERS}"
  echo
}

remove_existing_container_if_needed() {
  if ! "${DOCKER_CMD[@]}" container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
    return 0
  fi

  local answer=""
  echo "检测到已存在同名容器：${CONTAINER_NAME}"
  read -r -p "是否停止并删除旧容器后继续部署？[Y/n]: " answer
  answer="${answer:-Y}"
  if [[ ! "${answer}" =~ ^[Yy]$ ]]; then
    echo "已取消部署。"
    exit 0
  fi

  "${DOCKER_CMD[@]}" rm -f "${CONTAINER_NAME}" >/dev/null
}

pull_image() {
  echo
  echo "开始拉取镜像..."
  "${DOCKER_CMD[@]}" pull "${SYNC_IMAGE}"
}

run_container() {
  "${DOCKER_CMD[@]}" run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    -p "${BIND_ADDRESS}:${HOST_PORT}:8787" \
    -e NODE_ENV=production \
    -e HOST=0.0.0.0 \
    -e PORT=8787 \
    -e ROOM_EMPTY_TTL_MS="${ROOM_EMPTY_TTL_MS}" \
    -e MEMBER_HEARTBEAT_TIMEOUT_MS="${MEMBER_HEARTBEAT_TIMEOUT_MS}" \
    -e MAX_ROOM_MEMBERS="${MAX_ROOM_MEMBERS}" \
    -e MAX_QUEUE_ITEMS="${MAX_QUEUE_ITEMS}" \
    -e MAX_COMMANDS_PER_WINDOW="${MAX_COMMANDS_PER_WINDOW}" \
    -e RATE_LIMIT_WINDOW_MS="${RATE_LIMIT_WINDOW_MS}" \
    -e MAX_ROOM_OPS_PER_WINDOW="${MAX_ROOM_OPS_PER_WINDOW}" \
    -e ROOM_OPS_RATE_LIMIT_WINDOW_MS="${ROOM_OPS_RATE_LIMIT_WINDOW_MS}" \
    -e MAX_MESSAGE_BYTES="${MAX_MESSAGE_BYTES}" \
    -e CLEANUP_INTERVAL_MS="${CLEANUP_INTERVAL_MS}" \
    "${SYNC_IMAGE}" >/dev/null
}

confirm_and_deploy() {
  local answer=""
  read -r -p "确认开始部署？[Y/n]: " answer
  answer="${answer:-Y}"
  if [[ ! "${answer}" =~ ^[Yy]$ ]]; then
    echo "已取消部署。"
    exit 0
  fi

  remove_existing_container_if_needed
  pull_image
  run_container

  echo
  "${DOCKER_CMD[@]}" ps --filter "name=^${CONTAINER_NAME}$"
  echo
  echo "部署完成。"
  echo "请在扩展设置页的“服务端地址”中填写：${BIND_ADDRESS}:${HOST_PORT}"
  echo "也可以填写完整地址：ws://${BIND_ADDRESS}:${HOST_PORT}"
  echo "服务端同时兼容根路径 / 和旧路径 /ws，无需手动追加。"
}

main() {
  print_header
  require_command "docker" "Docker Engine 或 Docker Desktop"
  setup_docker_command
  load_interactive_values
  show_summary
  confirm_and_deploy
}

main "$@"
