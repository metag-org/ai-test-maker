# 復習テストメーカー（家庭作业转测验试卷系统）

将孩子已完成的家庭作业或练习卷（国语汉字 / 理科 / 社会）拍照上传，利用多模态 LLM 剔除手写与红笔批改干扰、自动提取题干/选项/插图坐标，并通过 OpenCV 裁剪与去手写清洗，支持智能抽题组卷及 **B4（国语竖排、理社横排）日本考卷级打印**。

## 技术架构

- **桌面一键版（macOS / Windows，内置便携 PostgreSQL 16）**：免 Docker、免装数据库、双击启动；自带系统托盘菜单（浏览器打开、同 Wi-Fi 手机拍照地址、一键 `.zip` 数据与图片备份、安全关库）
- **单 Docker 容器（轻量无 Chromium）**：Python 3.12 (`FastAPI` + `SQLAlchemy 2.0` + `Alembic` + `OpenCV headless`) + React 18 (`Vite` + `Tailwind CSS` + 离线内置日文印刷字体 `Shippori Mincho` / `BIZ UDPGothic`)
- **数据库**：PostgreSQL 16（桌面版内置绿色版 PostgreSQL；本地开发自带容器；NAS 生产复用外部网络 `nas-shared-net` 中的已有 Postgres）
- **打印引擎**：纯浏览器打印 / 另存为 PDF（`@media print` + `@page` 支持 JIS B4/A4、国语竖排傍线与汉字方格、理社横排双栏、综合卷自动按科目分页）

---

## 零、桌面一键安装包（推荐普通用户，内置 PostgreSQL）

无需安装 Docker、Python 或数据库，数据与题目 100% 保存在本机：
- **macOS**：下载 `ReviewTestMaker-<version>-macos-<arm64|x86_64>.dmg`，拖入「应用程序」后双击运行（首次打开如提示“无法验证开发者”，请右键图标点击「打开」或在「系统设置 → 隐私与安全性」中点击「仍要打开」）。
- **Windows**：下载 `ReviewTestMaker-<version>-windows-x64-setup.exe`，双击一键安装至当前用户目录（无需管理员权限，如遇 SmartScreen 提示点击「更多信息 → 仍要运行」）。
- **数据与备份位置**：
  - macOS：`~/Library/Application Support/ReviewTestMaker/`（含 `pgdata/`、`uploads/`、`backups/`、`logs/`）
  - Windows：`%LOCALAPPDATA%\ReviewTestMaker\`
  - 可在右上角/右下角系统托盘图标中随时点击 **「データ一括バックアップ (.zip)」** 导出数据库与图片完整备份压缩包。

### 本地自行构建桌面安装包

```bash
# macOS（自动拉取便携版 PostgreSQL 16 + 构建前端 + 打包 .app 与 .dmg）
./desktop/scripts/build_macos.sh
```

```powershell
# Windows PowerShell（需安装 Python 3.12+、Node.js 20+ 与 Inno Setup 6）
.\desktop\scripts\build_windows.ps1
```

> **自动发布双平台安装包**：推送形如 `v1.0.0` 的 Git Tag 或在 GitHub Actions 手动触发 `Build Desktop Installers (macOS & Windows)`，将自动构建 macOS (`arm64` / `x86_64`) `.dmg` 与 Windows `x64` `.exe` 安装包，执行内嵌 PostgreSQL 冒烟测试并发布至 GitHub Releases。

---

## 一、本地开发启动（Windows / Mac / Linux）

```bash
# 一键构建并启动（自带本地 PostgreSQL 16，自动建表迁移）
docker compose up -d --build
```

启动完成后浏览器访问：`http://localhost:8000`
1. 打开顶部菜单 **「設定」**，填入 Gemini API Key（推荐 `gemini-3.5-flash`）或 OpenAI 兼容接口配置并点击「接続テスト」。
2. 打开 **「問題登録」** 上传作业照片（或用同 Wi-Fi 手机访问 `http://<电脑局域网IP>:8000` 直接拍照）。

---

## 二、一键部署至 NAS（复用 `nas-shared-net` 已有 PostgreSQL）

### 前置准备（仅首次）
在 NAS 现有的 PostgreSQL 中为本系统创建一个空数据库（无需建表，容器启动时会自动执行 Alembic 迁移）：
```sql
CREATE DATABASE review_test;
```

### 部署步骤
1. 将本项目目录同步（或 `git clone`）到 NAS。
2. 复制 NAS 环境模板并填写数据库连接串：
   ```bash
   cp .env.nas.example .env
   # 编辑 .env，将 DATABASE_URL 改为 nas-shared-net 中 Postgres 的实际连接地址
   # 如需密码保护，可顺手填写 APP_PASSWORD=你的密码
   ```
3. 一键构建并启动（自动加入 `nas-shared-net` 并执行数据库迁移）：
   ```bash
   chmod +x deploy-nas.sh
   ./deploy-nas.sh
   # 或直接运行：
   # docker compose -f docker-compose.nas.yml up -d --build
   ```
4. 浏览器访问 `http://<NAS_IP>:8088`（端口可在 `.env` 的 `APP_PORT` 修改）。

> **离线镜像迁移方式（可选）**：如果 NAS 端不想本地编译镜像，可在开发机执行 `docker build -t review-test-app:latest . && docker save -o review-test-app.tar review-test-app:latest`，拷贝到 NAS 后 `docker load -i review-test-app.tar` 再运行 `docker compose -f docker-compose.nas.yml up -d --no-build`。

---

## 三、B4 / A4 打印技巧

1. 点击测试页右上角 **「印刷 / PDF保存」**，在浏览器打印对话框中：
   - **纸张大小**：选择 `JIS B4`（或与页面设置一致的 `A4`）
   - **方向**：与工具栏保持一致（推荐 B4 横向き + 理社 2段組）
   - **页眉和页脚**：取消勾选（去除浏览器默认的网址与页码）
   - **背景图形**：勾选（确保汉字方格虚线正常印出）
2. 综合卷会自动将 **国語（縦書き）**、**理科（横書き）**、**社会（横書き）** 分隔在不同页面打印。
