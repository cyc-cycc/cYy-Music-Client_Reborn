# cYy Music Client — Reborn

基于 **Electron 前端 + FastAPI 后端** 的本地音乐搜索/解析/下载/播放客户端。
后端使用 musicdl 提供音乐来源；前端是现代 HTML/CSS/JS（Electron），支持歌单解析、
批量下载、可视化播放、歌词嵌入、封面嵌入、格式转换和本地加密保存歌单等特性。

## 主要特性

- 多源搜索（基于 musicdl 支持的多个音乐源）
- 歌单解析（按平台解析歌单链接）
- 批量下载：并发、重试、进度广播（WebSocket）
- 封面代理与磁盘缓存（避免 CORS/防盗链）
- 嵌入歌词 / 封面到音频文件（mutagen）
- 可选下载后音频格式转换（ffmpeg）
- 流式播放：智能代理与 ffmpeg 转码（支持浏览器原生无损流 + 转码到 mp3）
- 可视化播放（前端频谱、瀑布和环形可视化；可视化内可直接切歌、选播放模式、查看悬浮歌单）
- 设置持久化（后端读写 config.json），设置选项由后端下发，前端不硬编码
- 歌单加密保存 / 解密加载（Fernet 方案）
- 动态端口（避免 8000 被占用时启动失败）
- 下载取消支持 WS 与 HTTP 双通道
- 视觉增强层（玻璃拟态 / 微交互 / 封面驱动动态主题 / 封面 3D 视差 / 播放条标题跑马灯）

## 代码结构

### 后端（批次 1 拆分，逻辑分散到 `backend/` 包）

| 文件 | 职责 |
|---|---|
| `server.py` | **入口**（~20 行）：按顺序执行 bootstrap → state → console_capture → app |
| `backend/bootstrap.py` | 最早副作用：musicdl 日志路径重定向、FFmpeg 定位、保存原始 stdout |
| `backend/state.py` | 全局状态：settings / 锁 / url 缓存 / 任务历史 / 取消标记（TTL） |
| `backend/broadcast.py` | WebSocket 线程安全广播（fire-and-forget） |
| `backend/console_capture.py` | 控制台捕获 + rich 进度解析（实时广播搜索/解析进度） |
| `backend/models.py` | Pydantic 请求模型 |
| `backend/clients.py` | MusicClient / RefreshClient / 源请求头 / 链接刷新 |
| `backend/downloader.py` | 下载核心（重试、原子替换、格式转换、歌词/封面嵌入） |
| `backend/app.py` | FastAPI 装配 + `run_server` |
| `backend/routes/*` | 每个模块对应一组 API |
| `constants.py` | 常量：搜索源映射、主题、播放模式枚举、路径 |
| `config.py` | 设置读写（`.CMC/config.json`，原子写入，含默认值） |
| `utils.py` | 工具：路径 / 日志 / 文件名 / 封面下载 / 格式转换 / 歌词嵌入 |

### 前端（批次 0 拆分）

| 文件 | 职责 |
|---|---|
| `frontend/main.js` | Electron 主进程：拉起后端、动态端口探测、数据目录定位 |
| `frontend/index.html` | 界面结构（含可视化 / 均衡器 / 悬浮歌单） |
| `frontend/style.css` | 主题变量 + 动效 |
| `frontend/renderer.js` | 渲染进程入口（仅 ~20 行） |
| `frontend/js/core.js` | 常量 / DOM 引用 / state / 工具 / API 封装 |
| `frontend/js/theme.js` | 主题、调色板、设置表单渲染 |
| `frontend/js/ui.js` | 弹窗、窗口控制、导航 |
| `frontend/js/player.js` | 歌词 + 播放控制 |
| `frontend/js/browse.js` | 搜索 / 歌单解析 / 播放列表 / 歌单文件 |
| `frontend/js/download.js` | 下载管理 + WebSocket |
| `frontend/js/eq-viz.js` | 均衡器、频谱、可视化 |
| `frontend/js/settings.js` | 设置表单事件 + 应用初始化 |
| `frontend/enhanced.css` | 视觉增强层样式（玻璃拟态 / 微交互 / 动态主色 / 视差） |
| `frontend/effects.js` | 视觉增强层交互（涟漪 / 入场错峰 / 视差 / 跑马灯） |
| `frontend/js/dynamic-theme.js` | 封面驱动动态主题（取主色 → 覆盖 `--primary`，可开关） |

## 目录结构（概览）

```
项目根/
├── server.py                                ← 后端入口
├── backend/                                 ← 后端包（批次 1）
│   ├── bootstrap.py / state.py / broadcast.py / console_capture.py
│   ├── models.py / clients.py / downloader.py / app.py
│   └── routes/
├── constants.py / config.py / utils.py
├── server.spec / requirements.txt
├── build.bat / run.bat / env_setup.bat / pack-source.bat
├── ffmpeg.exe
├── gui/icon.ico, icon_256.ico
├── cmcol/
├── frontend/
│   ├── main.js / index.html / renderer.js / style.css
│   ├── enhanced.css / effects.js            ← 视觉增强层
│   ├── js/                                  ← 渲染逻辑（批次 0）
│   │   ├── core.js / theme.js / ui.js / player.js
│   │   ├── dynamic-theme.js                 ← 封面驱动动态主题
│   │   ├── browse.js / download.js / eq-viz.js / settings.js
│   │   └── ...
│   ├── package.json
│   └── node_modules/
├── dist/                                    ← PyInstaller 产物
├── dist-app/                                ← electron-builder 产物
├── .CMC/ logs/ download/ cover_cache/ musicdl_outputs/
└── backup/
```

## Windows 辅助脚本

| 脚本 | 用途 |
|---|---|
| `env_setup.bat` | 一键搭建环境：创建 `cmcol` 虚拟环境、安装后端依赖、安装前端依赖 |
| `run.bat` | 开发模式启动 Electron（自动拉起本地 Python 后端） |
| `build.bat` | 交互式打包：NSIS 安装包 / 便携版 / 仅编译 Py 后端 |
| `pack-source.bat` | 把源代码（排除依赖/产物/运行时数据）打包成 `.7z` 备份 |

## 快速开始（开发模式）

> **Windows 用户快捷方式**：首次使用先双击 `env_setup.bat` 搭建环境，之后双击 `run.bat`
> 即可开发模式启动（两者会自动设置国内镜像加速）。

前提：
- Python 3.10+
- Node.js + npm / yarn
- ffmpeg 可用

### 后端

```bash
python -m venv .venv
.venv\Scripts\activate           # Windows
# source .venv/bin/activate      # macOS / Linux
pip install -r requirements.txt
python server.py
```

默认监听 `127.0.0.1:8000`（若被占用，启动时可通过环境变量 `CMC_API_PORT` 指定）。

### 前端

```bash
cd frontend
npm install
npm start
```

`main.js` 在开发模式会自动运行本地 Python 后端（优先使用 `cmcol` 虚拟环境）。
动态端口会通过 `CMC_API_PORT` 传给渲染进程。

## 生产打包（简要）

### 后端（PyInstaller）

```bash
pip install pyinstaller
pyinstaller --noconfirm server.spec
```

产物位于 `dist/cyy_backend`，会被 Electron 打包为 `extraResources/backend`。

### 前端（electron-builder）

```bash
cd frontend
npm run dist            # 或 dist:portable / dist:nsis / dist:dir
```

## 配置与数据目录

数据目录优先级：
1. 环境变量 `CMC_DATA_DIR`（由 Electron 主进程注入）；
2. macOS（未设置 `CMC_DATA_DIR`）：`~/Documents/CMC`；
3. 其他平台默认使用代码目录（`APP_DIR`）。

配置文件：`{DATA_DIR}/.CMC/config.json`（原子写入）。

常用环境变量：
- `CMC_DATA_DIR` — 数据目录（配置、日志、下载、封面缓存等）
- `CMC_API_PORT` — 后端监听端口（默认 8000）
- `PORTABLE_EXECUTABLE_DIR` — Electron 便携运行时（前端脚本会读取）
- `MUSICDL_GUI_DEBUG` — 设置日志级别（默认只写 ERROR 到文件）

默认设置字段（详见 `config.py:DEFAULT_SETTINGS`）：
`sources`、`limit`、`dedup`、`save_dir`、`filename_format`、`custom_format`、
`download_lyric`、`download_cover`、`volume`、`play_mode`、`convert_enabled`、
`convert_format`、`convert_bitrate`、`theme`、`theme_color`、`theme_custom`、
`background_opacity`、`show_progress_detail`、`embed_lyrics`、`delete_lyrics`、
`embed_cover`、`delete_cover`、`group_by`、`dynamic_theme`、`eq`。

## 后端 API（简要）

Base URL：`http://127.0.0.1:<port>`（端口由主进程动态分配，通过 `CMC_API_PORT` 下发）

| 端点 | 说明 |
|---|---|
| `GET /` | 健康检查 |
| `GET /settings` | 获取当前设置 |
| `POST /settings` | 更新设置（部分字段） |
| `GET /settings/options` | 获取前端选项（源分组、文件名格式、主题等） |
| `POST /search` | 多源并行搜索（`{keyword, request_id?}`） |
| `POST /search/cancel` | 取消搜索（`{request_id}`） |
| `POST /parse_playlist` | 解析歌单（`{url, source_display, request_id?}`） |
| `POST /parse_playlist/cancel` | 取消解析 |
| `POST /refresh` | 刷新下载链接（`{songs:[...]}`） |
| `POST /download` | 启动下载任务（`{songs:[...], save_dir?}`）→ 返回 `task_ids` |
| `POST /download/cancel` | HTTP 取消下载（WS 不可用时的回退，`{task_id}`） |
| `GET /tasks` | 最近任务状态历史（WS 断开后轮询对账） |
| `WS /ws` | 接收下载/搜索/解析进度事件；客户端可发 `{action:'cancel', task_id}` |
| `GET /cover?url=...&source=...` | 封面代理（磁盘缓存） |
| `GET /stream?url=...&source=...&ext=...&start=...` | 流式播放（智能直传或 ffmpeg 转码） |
| `POST /playlist/encrypt` | 加密保存歌单 |
| `POST /playlist/decrypt` | 解密歌单 |

### WebSocket 消息示例（后端 → 前端）

- 搜索进度：`{type:'search_progress', source:'KuwoMusicClient', processing:2, page:1}`
- 解析进度：`{type:'parse_progress', done:X, total:Y}`
- 下载进度：`{type:'progress', task_id:N, percent:42}`
- 下载结束：`{type:'done'|'error'|'cancelled', task_id:N, ...}`

## 重要实现与注意事项

- **启动顺序**：`server.py` 顶部严格按 `bootstrap → state → console_capture → app` 顺序导入，
  确保 `platformdirs` 重定向、FFmpeg 路径注入、stdout/stderr 重定向都在任何 musicdl/rich 导入之前完成。
- **MusicClient**：懒加载，切换设置会重置客户端（下次使用自动重建）。
- **控制台捕获**：`backend.console_capture` 把 stdout/stderr 重定向到管道，后台线程解析 rich
  进度输出并通过 WS 广播（受 `show_progress_detail` 开关控制）。
- **链接刷新**：优先 `identifier` 精确匹配；HEAD 校验会携带源请求头/Cookie；TTLCache 缓存 300s。
- **下载**：requests + 临时文件 + 原子替换 + 3 次重试；先按源扩展名下载，转换成功后再改名。
- **歌单加密**：`cryptography.Fernet`，密钥基于 `constants.ENCRYPTION_PASSWORD`。
- **封面代理**：缓存到 `{DATA_DIR}/cover_cache`，`filetype` 库推断图片格式。
- **动态端口**：`frontend/main.js` 从 8000 开始探测可用端口，通过环境变量传给后端与渲染进程，
  避免端口占用导致启动失败。
- **视觉增强层**：`enhanced.css` / `effects.js` / `js/dynamic-theme.js` 三层与 `style.css` 绑定，
  不可单独删除；交互元素背景一律由 `::before` 承载、只过渡 `opacity`；需要过渡的元素初始
  透明度用 `0.01` 而非 `0`（否则 Chromium 会跳过合成层，导致首帧瞬移）；只动 `transform` /
  `opacity` 做动画，禁用 `filter: blur` / `left` / `top` 等布局属性。

## 常见故障排查

- **后端无法启动或导入 musicdl 报错**：确认 `requirements.txt` 依赖完整（尤其 `curl_cffi`）；
  PyInstaller 打包后若出现 `ImportError: backend.xxx`，检查 `server.spec` 的 `hiddenimports` 和 `datas`。
- **ffmpeg 未找到 / 转码失败**：确认 ffmpeg 在 PATH 中或已打包到 `backend/`。
- **播放卡顿 / 进度不更新**：检查 WS 是否已连接；查看 `logs/` 下的 `CMC.log`、
  `backend_stdout.log`、`musicdl/musicdl.log`。
- **无法下载 / 链接失效**：前端会自动调用 `/refresh`；查看后端日志排查刷新失败原因。

## 常用命令小结

```bash
# 启动后端（开发）
python server.py

# 启动 Electron（开发）
cd frontend && npm install && npm start

# 打包后端
pip install pyinstaller && pyinstaller --noconfirm server.spec

# 打包 Electron 应用
cd frontend && npm run dist
```

## 许可证

本项目在 `package.json` 中声明为 GPL-3.0。请遵循 GPL-3.0 条款分发/修改本软件。

## 致谢

- musicdl：提供众多音乐源的抓取/解析能力
- FastAPI / uvicorn：后端服务与 WebSocket 支持
- Electron：跨平台桌面 UI