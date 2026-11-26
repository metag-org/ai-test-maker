#!/usr/bin/env bash
# ==============================================================================
# 復習テストメーカー - Synology NAS (192.168.99.200) 一键发布脚本
# 用法:
#   ./deploy-nas.sh
# ==============================================================================
set -euo pipefail

NAS_HOST="${NAS_HOST:-192.168.99.200}"
NAS_PORT="${NAS_PORT:-2222}"
NAS_USER="${NAS_USER:-docker-user}"
NAS_SSH_KEY="${NAS_SSH_KEY:-$HOME/.ssh/synology_nas}"
NAS_DIR="${NAS_DIR:-/volume1/docker/sapix-test-maker}"
ARCHIVE_PATH="/tmp/sapix_test_maker.tar.gz"

SSH_BASE_OPTS=(-o StrictHostKeyChecking=no)
if [ -f "${NAS_SSH_KEY}" ]; then
  SSH_BASE_OPTS=(-i "${NAS_SSH_KEY}" "${SSH_BASE_OPTS[@]}")
fi

cleanup() {
  rm -f "${ARCHIVE_PATH}"
}
trap cleanup EXIT

echo "==> [1/3] 正在打包源码..."
COPYFILE_DISABLE=1 tar -czf "${ARCHIVE_PATH}" \
  --exclude='node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  --exclude='backend/__pycache__' \
  --exclude='backend/.venv' \
  --exclude='data' \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='._*' \
  Dockerfile .dockerignore docker-compose.nas.yml .env.nas.example backend frontend

echo "==> [2/3] 正在上传源码包至 NAS (${NAS_USER}@${NAS_HOST}:${NAS_PORT})..."
scp -O "${SSH_BASE_OPTS[@]}" -P "${NAS_PORT}" \
  "${ARCHIVE_PATH}" "${NAS_USER}@${NAS_HOST}:${ARCHIVE_PATH}"

echo "==> [3/3] 正在 NAS 上构建镜像并更新容器..."
ssh "${SSH_BASE_OPTS[@]}" -p "${NAS_PORT}" "${NAS_USER}@${NAS_HOST}" "
  set -e
  export PATH=/usr/local/bin:\$PATH
  DOCKER_CMD='docker'
  if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD='sudo -n docker'
  fi
  mkdir -p ${NAS_DIR}/data/uploads
  if [ ! -f '${NAS_DIR}/.env' ]; then
    echo '❌ 错误: ${NAS_DIR}/.env 不存在，请先在 NAS 上配置 .env（可参考 .env.nas.example）'
    exit 1
  fi
  if ! \${DOCKER_CMD} network inspect nas-shared-net >/dev/null 2>&1; then
    echo '❌ 错误: 外部 Docker 网络 nas-shared-net 不存在'
    exit 1
  fi
  tar -xzf ${ARCHIVE_PATH} -C ${NAS_DIR}
  cp ${NAS_DIR}/docker-compose.nas.yml ${NAS_DIR}/docker-compose.yml
  rm -f ${ARCHIVE_PATH}
  cd ${NAS_DIR}
  \${DOCKER_CMD} compose up -d --build
  \${DOCKER_CMD} compose ps
"

echo "✅ 发布完成！"
