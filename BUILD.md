# cYy Music Client 打包指南（编译为可分发的 Windows exe）

本项目是 **Electron 前端 + Python(FastAPI) 后端** 的混合应用。分发时把后端用
**PyInstaller** 冻结为独立 exe，再用 **electron-builder** 把前端 + 后端 + ffmpeg
打包成单个可分发程序。

## 打包产物

| 目标 | 命令 | 产物 |
|---|---|---|
| 单文件便携版（免安装，双击即用） | `npm run dist:portable` | `dist-app/cYy-Music-Client-Reborn-5.3.2-portable.exe` |
| NSIS 安装包（带卸载/开始菜单） | `npm run dist:nsis` | `dist-app/cYy Music Client - Reborn Setup 5.3.2.exe` |
| 免安装器解包版（调试用） | `npm run dist:dir` | `dist-app/win-unpacked/` |

> 推荐：直接双击根目录 **`build.bat`** 交互式选择「NSIS / 便携版 / 仅编译后端」。

## 目录结构（打包相关）

```
项目根/
├── server.py                                     ← PyInstaller 入口（仅 ~20 行）
├── backend/                                      ← 后端包（批次 1 拆分）
│   ├── bootstrap.py / state.py / broadcast.py
│   ├── console_capture.py / models.py / clients.py / downloader.py
│   ├── app.py
│   └── routes/
├── constants.py / config.py / utils.py           ← 后端核心模块
├── server.spec                                   ← PyInstaller 配置
├── requirements.txt
├── ffmpeg.exe                                    ← 流播放/转码依赖
├── env_setup.bat / run.bat / build.bat / pack-source.bat
├── gui/icon.ico, icon_256.ico
├── cmcol/                                        ← 开发虚拟环境
├── frontend/
│   ├── main.js / index.html / renderer.js / style.css
│   ├── enhanced.css / effects.js                 ← 视觉增强层（必须列入 package.json 的 files）
│   ├── js/                                       ← 渲染逻辑（批次 0 拆分）
│   │   ├── core.js / theme.js / ui.js / player.js
│   │   ├── dynamic-theme.js                      ← 封面驱动动态主题
│   │   ├── browse.js / download.js / eq-viz.js
│   │   └── settings.js
│   ├── package.json                              ← files 需显式含 enhanced.css / effects.js / js/**/*
│   └── node_modules/
├── dist/                                         ← PyInstaller 产物
├── dist-app/                                     ← electron-builder 产物
├── .CMC/ logs/ download/ cover_cache/ musicdl_outputs/
└── backup/
```

## 用 build.bat 打包（推荐）

双击 `build.bat`，按提示选择：

1. **NSIS 安装包**（全应用，最省事）
2. **便携版 Portable**
3. **仅编译 Py 后端**（PyInstaller）→ 之后会问是否继续打包前端

前置条件：
- 已用 `env_setup.bat` 建好 `cmcol` 虚拟环境并装好前端依赖；
- 编译后端前需先装 PyInstaller：
  ```bat
  call cmcol\Scripts\activate.bat
  pip install pyinstaller
  ```

## 完整构建流程（手动）

### 1. 安装打包工具（只需一次）

```powershell
# 后端打包：PyInstaller（装进 cmcol 虚拟环境）
& .\cmcol\Scripts\python.exe -m pip install pyinstaller

# 前端打包：electron-builder（装进 frontend）
cd frontend
npm install --save-dev electron-builder
cd ..
```

> 网络不佳时建议设置国内镜像：
> ```powershell
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
> ```

### 2. 打包后端（PyInstaller）

```powershell
# 在项目根目录执行，生成 dist\cyy_backend\cyy_backend.exe（约 77MB）
& .\cmcol\Scripts\python.exe -m PyInstaller --noconfirm --clean server.spec
```

`server.spec` 关键点：
- **`hiddenimports`** 显式列出 `backend.*`（含所有 `backend.routes.*`）和 uvicorn 的 auto 发现子模块；
- **`datas`** 把 `backend/` 目录作为数据一并收集，避免动态导入失败；
- **`--collect-all musicdl`**（在 spec 内部通过 `collect_data_files` 或构建时的 hook 处理）：musicdl 包内非 .py 资源（youtube js、widevine `.wvd` 设备文件）必须收集；
- **`excludes`** 排除 `nodejs_wheel`（113MB，仅 YouTube potoken）、`av`/`PIL`/`faster_whisper`、
  `PyQt5`/`librosa`/`matplotlib`/`scipy` 等纯 GUI / 分析依赖。

### 3. 打包整个应用（electron-builder）

```powershell
cd frontend
npm run dist:portable   # 或 dist:nsis / dist:dir
```

配置（`frontend/package.json` 的 `build` 字段）已就绪：
- **`files`** 必须显式包含 `enhanced.css`、`effects.js`（它们在 `frontend/` 根目录，不在 `js/**` 覆盖范围内）以及 `js/**/*`。**漏掉前两者会导致打包后视觉增强层完全缺失**——开发模式看不出来，只在 dist 后暴露。
- **`extraResources`** 把 `dist\cyy_backend` 复制进 `resources\backend`，`ffmpeg.exe` 放同一目录；
- **`win.icon`** 使用 `gui/icon_256.ico`；
- 产物输出到项目根 `dist-app\`。

### 4. 验证

```powershell
# 解包版直接运行（自动拉起内置后端）
.\dist-app\win-unpacked\cYy Music Client.exe
```

启动后确认标题栏左侧的 **cYy 音符 logo** 存在（说明 `enhanced.css` / `effects.js` 已被正确打包）。
如需进一步确认 asar 内容，可用 `npx asar list .\dist-app\win-unpacked\resources\app.asar` 查看。

## 运行时行为（打包后）

- **后端定位**：`frontend/main.js` 在打包模式下启动 `resources\backend\cyy_backend.exe`，
  开发模式下启动 `python server.py`（自动识别 `cmcol` 虚拟环境）；
- **后端入口**：`server.py` 仅做初始化编排（bootstrap → state → console_capture → app），
  所有业务逻辑都在 `backend/` 包内；
- **数据目录**：配置(`.CMC\`)、日志(`logs\`)、默认下载目录(`download\`)、封面缓存(`cover_cache\`)、
  musicdl 缓存(`musicdl_outputs\`) 的归属（由 `frontend/main.js` 计算后经 `CMC_DATA_DIR` 传给后端）：
  - 便携版：`PORTABLE_EXECUTABLE_DIR` 环境变量，即便携 exe 所在目录；
  - **安装版（NSIS）/解包版：userData 目录**（`%APPDATA%\cyy-music-client`）；
  - 开发模式：不设置（后端默认使用项目根目录）。
- **动态端口**：`main.js` 从 8000 开始探测可用端口，通过 `CMC_API_PORT` 传给后端与渲染进程；
- **ffmpeg 定位**：`utils.setup_runtime_paths` 支持在可执行文件同目录查找裸 `ffmpeg.exe`；
- **无控制台适配**：`backend.console_capture.start()` 在非 TTY 环境把 stdout/stderr 重定向到
  `logs\backend_stdout.log`，避免 rich 向无效控制台句柄写入导致 `OSError [Errno 22]`；
- **日志上限**：`logs\CMC.log` 与 `logs\backend_stdout.log` 超过 1MB 自动轮转。

## 常见问题

- **build.bat 选「仅编译后端」报 pyinstaller 找不到**：cmcol 虚拟环境没装 PyInstaller；
- **打包后 ImportError: backend.xxx**：检查 `server.spec` 的 `hiddenimports` 是否含对应子模块，
  以及 `datas` 是否包含 `('backend', 'backend')`；
- **打包后视觉增强层消失（玻璃拟态 / 视差 / logo 全没了）**：`frontend/package.json` 的
  `build.files` 漏了 `enhanced.css` 或 `effects.js`。这两者在 `frontend/` 根目录，不在
  `js/**` 覆盖范围内，必须显式列出；
- **搜索 0 条 / 刷新失败**：看 `%APPDATA%\cyy-music-client\logs\CMC.log`（安装版）
  或项目根 `logs\`（开发），以及 `backend_stdout.log` 与 `logs\musicdl\musicdl.log`；
- **端口被占用**：main.js 会自动探测下一个可用端口，无需手动处理；
- **杀毒误报**：PyInstaller 单文件便携版易被误报，可换 NSIS 安装版或加白名单；
- **想改搜索源**：在应用设置里勾选；后端重启后自动重建客户端。