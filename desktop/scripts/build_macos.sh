#!/usr/bin/env bash
# ==============================================================================
# Build macOS .app and .dmg with Embedded PostgreSQL
# Usage:
#   ./desktop/scripts/build_macos.sh [--skip-frontend] [--skip-pg]
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP_DIR="${REPO_ROOT}/desktop"
BUILD_VENV="${DESKTOP_DIR}/.venv-build"
DIST_DIR="${DESKTOP_DIR}/dist"
WORK_DIR="${DESKTOP_DIR}/build"
APP_VERSION="${APP_VERSION:-1.0.0}"
ARCH="$(uname -m)"
if [ "${ARCH}" = "arm64" ]; then
  PG_PLATFORM="darwin-arm64"
else
  PG_PLATFORM="darwin-x64"
fi

SKIP_FRONTEND=0
SKIP_PG=0
for arg in "$@"; do
  case "$arg" in
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-pg) SKIP_PG=1 ;;
  esac
done

# Fallback to CommandLineTools if Xcode.app lipo/codesign shim is mismatched
if ! lipo -info /bin/ls >/dev/null 2>&1 && [ -d "/Library/Developer/CommandLineTools" ]; then
  export DEVELOPER_DIR="/Library/Developer/CommandLineTools"
  echo "==> Using DEVELOPER_DIR=${DEVELOPER_DIR} for macOS build tools"
fi

echo "==> [1/6] Setting up Python build environment (${ARCH})..."
PYTHON_BIN="${PYTHON_BIN:-python3}"
if [ ! -d "${BUILD_VENV}" ]; then
  "${PYTHON_BIN}" -m venv "${BUILD_VENV}"
fi
source "${BUILD_VENV}/bin/activate"
pip install --upgrade pip >/dev/null
pip install -r "${REPO_ROOT}/backend/requirements.txt" -r "${DESKTOP_DIR}/requirements-desktop.txt"

if [ "${SKIP_FRONTEND}" -eq 0 ]; then
  echo "==> [2/6] Building React frontend..."
  (
    cd "${REPO_ROOT}/frontend"
    npm install --no-audit --no-fund
    npm run build
  )
else
  echo "==> [2/6] Skipping frontend build (--skip-frontend)"
fi

echo "==> [3/6] Generating macOS & Windows app icons..."
python "${DESKTOP_DIR}/scripts/generate_icons.py"

if [ "${SKIP_PG}" -eq 0 ]; then
  echo "==> [4/6] Fetching embedded PostgreSQL runtime (${PG_PLATFORM})..."
  python "${DESKTOP_DIR}/scripts/fetch_postgres.py" --platform "${PG_PLATFORM}"
else
  echo "==> [4/6] Skipping PostgreSQL fetch (--skip-pg)"
fi

echo "==> [5/6] Building macOS .app bundle with PyInstaller..."
rm -rf "${DIST_DIR}/ReviewTestMaker" "${DIST_DIR}/ReviewTestMaker.app" "${WORK_DIR}"
APP_VERSION="${APP_VERSION}" pyinstaller \
  --noconfirm \
  --clean \
  --distpath "${DIST_DIR}" \
  --workpath "${WORK_DIR}" \
  "${DESKTOP_DIR}/review_test_maker.spec"

APP_BUNDLE="${DIST_DIR}/ReviewTestMaker.app"
PG_TARGET="${APP_BUNDLE}/Contents/Resources/runtime/postgres"
echo "==> Embedding PostgreSQL into ${PG_TARGET}..."
mkdir -p "$(dirname "${PG_TARGET}")"
rm -rf "${PG_TARGET}"
cp -a "${DESKTOP_DIR}/runtime/postgres" "${PG_TARGET}"

# Ad-hoc sign so Apple Silicon macOS allows local execution cleanly
echo "==> Applying ad-hoc codesign to app bundle..."
codesign --force --deep --sign - "${APP_BUNDLE}"

echo "==> [6/6] Creating macOS .dmg installer..."
DMG_STAGING="${WORK_DIR}/dmg-staging"
rm -rf "${DMG_STAGING}"
mkdir -p "${DMG_STAGING}"
cp -a "${APP_BUNDLE}" "${DMG_STAGING}/"
ln -s /Applications "${DMG_STAGING}/Applications"

DMG_NAME="ReviewTestMaker-${APP_VERSION}-macos-${ARCH}.dmg"
DMG_PATH="${DIST_DIR}/${DMG_NAME}"
rm -f "${DMG_PATH}"
for attempt in 1 2 3 4 5; do
  if hdiutil create \
    -volname "ReviewTestMaker" \
    -srcfolder "${DMG_STAGING}" \
    -ov \
    -format UDZO \
    "${DMG_PATH}"; then
    break
  fi
  if [ "${attempt}" -eq 5 ]; then
    echo "❌ hdiutil create failed after 5 attempts"
    exit 1
  fi
  echo "hdiutil create failed (attempt ${attempt}/5), retrying in 5s..."
  rm -f "${DMG_PATH}"
  sleep 5
done

echo "✅ macOS build complete:"
echo "   App: ${APP_BUNDLE}"
echo "   DMG: ${DMG_PATH} ($(du -h "${DMG_PATH}" | awk '{print $1}'))"
