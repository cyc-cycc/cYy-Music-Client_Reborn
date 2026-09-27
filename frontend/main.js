// frontend/main.js
const { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

require('@electron/remote/main').initialize();

let mainWindow = null;
let miniWindow = null;
let desktopLyricWindow = null;
let playerStateCache = {};
let pythonProcess = null;
let apiPort = 8000;

let isQuitting = false;
let backendStartTime = 0;
let backendCrashCount = 0;
let backendRestartTimer = null;
let backendLastError = null;
let backendReadyTimer = null;

const MAX_BACKEND_RESTARTS = 3;
const isDev = !app.isPackaged;
const DEFAULT_API_PORT = 8000;
const PORT_SCAN_RANGE = 20;             // 在 [DEFAULT, DEFAULT+19] 内探测
const WINDOW_SHOW_TIMEOUT_MS = 5000;

// ==================== 窗口状态持久化 ====================
// 位置与尺寸独立存于 {dataDir}/.CMC/window-state.json，
// 与后端 config.json 解耦（后端未启动时也能定位窗口）。
// 结构：{ main: {x,y,width,height,maximized}, mini: {...}, desktopLyric: {...} }
//
// 保存策略：仅在窗口 close 事件触发时同步落盘。
// - 正常关闭：触发，写盘
// - 应用退出（window-all-closed → app.quit）：主窗口 close 先触发，写盘
// - 强杀 / 断电：不写盘，位置回到上次正常关闭时的值（这是选择该策略的已知代价）
let _windowStateCache = null;

function _getWindowStatePath() {
    const dir = getDataDir() || path.join(__dirname, '..');
    return path.join(dir, '.CMC', 'window-state.json');
}

function loadWindowState() {
    if (_windowStateCache) return _windowStateCache;
    _windowStateCache = {};
    try {
        const p = _getWindowStatePath();
        if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                _windowStateCache = parsed;
            }
        }
    } catch (e) {
        console.warn('读取窗口状态失败:', e);
    }
    return _windowStateCache;
}

/** 原子写入：临时文件 + rename，避免写一半崩溃损坏文件。 */
function _flushWindowState() {
    try {
        const p = _getWindowStatePath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(_windowStateCache || {}, null, 2), 'utf-8');
        fs.renameSync(tmp, p);
    } catch (e) {
        console.warn('保存窗口状态失败:', e);
    }
}

/** 判断矩形是否与任一显示器工作区有交集（防止恢复到已拔掉的显示器）。 */
function _isBoundsOnScreen(bounds) {
    if (!bounds
        || typeof bounds.x !== 'number' || typeof bounds.y !== 'number'
        || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
        return false;
    }
    try {
        const { screen } = require('electron');
        for (const d of screen.getAllDisplays()) {
            const wa = d.workArea;
            if (bounds.x < wa.x + wa.width &&
                bounds.x + bounds.width > wa.x &&
                bounds.y < wa.y + wa.height &&
                bounds.y + bounds.height > wa.y) {
                return true;
            }
        }
    } catch (e) {}
    return false;
}

/** 抓取窗口当前几何状态。最大化时用 getNormalBounds 取"还原后"的边界。 */
function _captureBounds(win) {
    if (!win || win.isDestroyed()) return null;
    try {
        const maximized = win.isMaximized();
        const b = maximized ? win.getNormalBounds() : win.getBounds();
        return { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
    } catch (e) {
        return null;
    }
}

/** 挂载"关闭时同步保存"。仅监听 close，不做实时跟踪。 */
function _trackWindowState(win, key) {
    if (!win || win.isDestroyed()) return;
    win.on('close', () => {
        const s = _captureBounds(win);
        if (!s) return;
        loadWindowState()[key] = s;
        _flushWindowState();
    });
}

/**
 * 合并已保存状态与默认值。
 * 返回的对象**必定**含 width/height；含 x/y 时表示使用保存位置；
 * 不含 x/y 时交给 BrowserWindow 自动居中。
 */
function _applySavedBounds(key, defaults) {
    const saved = loadWindowState()[key];
    if (!saved) return { ...defaults, maximized: false };

    const candidate = {
        x: saved.x, y: saved.y,
        width: saved.width, height: saved.height,
    };
    if (!_isBoundsOnScreen(candidate)) {
        // 显示器已变化，回落默认
        return { ...defaults, maximized: false };
    }
    return {
        x: saved.x,
        y: saved.y,
        width: saved.width,
        height: saved.height,
        maximized: !!saved.maximized,
    };
}

// ==================== 端口探测 ====================
/**
 * 探测可用端口。返回可用端口号，或 null（范围内全被占用）。
 * 不再"超时/超次退回默认端口"——那会把后端启动到被占用的端口上。
 */
function findAvailablePort(startPort, maxTries = PORT_SCAN_RANGE) {
    return new Promise((resolve) => {
        let current = startPort;
        const tryPort = () => {
            if (current >= startPort + maxTries) {
                resolve(null);
                return;
            }
            const tester = net.createServer();
            tester.once('error', () => { current += 1; tryPort(); });
            tester.once('listening', () => {
                tester.close(() => resolve(current));
            });
            tester.listen(current, '0.0.0.0');
        };
        tryPort();
    });
}

// ==================== 窗口管理 ====================
function showMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    }
}

ipcMain.on('window-ready-to-show', () => showMainWindow());

function createWindow(port) {
    const st = _applySavedBounds('main', { width: 1200, height: 800 });
    const opts = {
        width: st.width,
        height: st.height,
        minWidth: 1000,
        minHeight: 700,
        frame: false,
        transparent: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            // 通过 additionalArguments 可靠地把端口传给渲染进程，
            // 渲染进程可通过 process.argv 读取，避免依赖 process.env 的时序问题
            additionalArguments: [`--cmc-api-port=${port}`],
        },
    };
    // 只有拿到有效保存位置时才指定 x/y；否则让 Electron 自动居中
    if (typeof st.x === 'number' && typeof st.y === 'number') {
        opts.x = st.x;
        opts.y = st.y;
    }

    mainWindow = new BrowserWindow(opts);
    require('@electron/remote/main').enable(mainWindow.webContents);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    _trackWindowState(mainWindow, 'main');

    if (st.maximized) {
        // 若上次为最大化，先按普通边界创建、再 maximize，
        // 这样 getNormalBounds() 仍能记住还原后的位置。
        mainWindow.once('ready-to-show', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                try { mainWindow.maximize(); } catch (e) {}
            }
        });
    }

    setTimeout(showMainWindow, WINDOW_SHOW_TIMEOUT_MS);

    if (isDev && process.env.CMC_DEVTOOLS === '1') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
        [miniWindow, desktopLyricWindow].forEach(w => {
            if (w && !w.isDestroyed()) w.close();
        });
    });
}

function getDataDir() {
    if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
    if (app.isPackaged) return app.getPath('userData');
    return null;
}

function createMiniWindow() {
    if (miniWindow && !miniWindow.isDestroyed()) {
        if (!miniWindow.isVisible()) miniWindow.show();
        miniWindow.focus();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mini-opened');
        }
        return;
    }
    const st = _applySavedBounds('mini', { width: 380, height: 140 });
    const opts = {
        width: st.width,
        height: st.height,
        minWidth: 320,
        minHeight: 120,
        frame: false,
        transparent: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        roundedCorners: false,
        resizable: true,
        skipTaskbar: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
    };
    if (typeof st.x === 'number' && typeof st.y === 'number') {
        opts.x = st.x;
        opts.y = st.y;
    }

    miniWindow = new BrowserWindow(opts);
    try { miniWindow.setHasShadow(false); } catch (e) {}
    miniWindow.loadFile(path.join(__dirname, 'mini.html'));
    _trackWindowState(miniWindow, 'mini');

    miniWindow.once('ready-to-show', () => {
        if (miniWindow && !miniWindow.isDestroyed()) {
            miniWindow.show();
            // 主动推送当前状态，避免迷你窗口 invoke 时机早于主窗口报告，
            // 导致其停留在 mini.html 里硬编码的默认主题色。
            // 与 desktopLyricWindow 的处理保持一致。
            if (playerStateCache && Object.keys(playerStateCache).length) {
                miniWindow.webContents.send('player-state', playerStateCache);
            }
        }
    });
    miniWindow.on('closed', () => {
        miniWindow = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mini-state-changed', { open: false });
        }
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mini-state-changed', { open: true });
        // 首次创建时也触发主窗口 report 一次，确保 playerStateCache 里的
        // primary / theme 是最新的（用户可能改过主题色，或应用刚启动）。
        // 与"已打开"分支的行为保持一致。
        mainWindow.webContents.send('mini-opened');
    }
    if (isDev && process.env.CMC_DEVTOOLS === '1') {
        miniWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

function createDesktopLyricWindow() {
    if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
        if (!desktopLyricWindow.isVisible()) desktopLyricWindow.show();
        return;
    }
    const { screen } = require('electron');
    const wa = screen.getPrimaryDisplay().workAreaSize;
    // 默认：主显示器底部居中
    const st = _applySavedBounds('desktopLyric', {
        width: 800,
        height: 100,
        x: Math.floor((wa.width - 800) / 2),
        y: wa.height - 160,
    });
    const opts = {
        width: st.width,
        height: st.height,
        frame: false,
        transparent: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        resizable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
    };
    if (typeof st.x === 'number' && typeof st.y === 'number') {
        opts.x = st.x;
        opts.y = st.y;
    }

    desktopLyricWindow = new BrowserWindow(opts);
    try { desktopLyricWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {}
    // macOS：桌面歌词需在所有工作区 / 全屏应用之上保持可见
    if (process.platform === 'darwin') {
        try {
            desktopLyricWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch (e) {}
    }
    desktopLyricWindow.loadFile(path.join(__dirname, 'desktop-lyric.html'));
    _trackWindowState(desktopLyricWindow, 'desktopLyric');

    desktopLyricWindow.once('ready-to-show', () => {
        if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
            desktopLyricWindow.show();
            if (playerStateCache) {
                desktopLyricWindow.webContents.send('player-state', playerStateCache);
            }
        }
    });
    desktopLyricWindow.on('closed', () => { desktopLyricWindow = null; });
}

// ==================== IPC: 窗口动作 ====================
ipcMain.on('open-mini-player', () => createMiniWindow());
ipcMain.on('close-mini-player', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
});

ipcMain.on('toggle-desktop-lyric', () => {
    if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) desktopLyricWindow.close();
    else createDesktopLyricWindow();
});
ipcMain.on('desktop-lyric-context', () => {
    if (!desktopLyricWindow || desktopLyricWindow.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
        { label: '关闭桌面歌词', click: () => {
            if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) desktopLyricWindow.close();
        }},
    ]);
    menu.popup({ window: desktopLyricWindow });
});

ipcMain.on('player-state-update', (_evt, payload) => {
    playerStateCache = payload || {};
    [miniWindow, desktopLyricWindow].forEach(w => {
        if (w && !w.isDestroyed()) {
            w.webContents.send('player-state', playerStateCache);
        }
    });
});

ipcMain.on('mini-action', (_evt, action) => {
    if (!action || !action.type) return;
    if (action.type === 'toggle-desktop-lyric') {
        if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
            desktopLyricWindow.close();
        } else {
            createDesktopLyricWindow();
        }
        return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('player-action', action);
    }
});
ipcMain.on('player-action', (_evt, action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('player-action', action);
    }
});

ipcMain.handle('get-player-state', () => playerStateCache);
ipcMain.handle('mini-get-state', () => playerStateCache);

ipcMain.on('show-main-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    }
});

function sendPlayerAction(action) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('player-action', action);
    }
}

// ==================== 媒体快捷键 ====================
app.whenReady().then(() => {
    const mediaKeys = [
        ['MediaPlayPause', { type: 'toggle' }],
        ['MediaNextTrack', { type: 'next' }],
        ['MediaPreviousTrack', { type: 'prev' }],
        ['MediaStop', { type: 'stop' }],
    ];
    mediaKeys.forEach(([key, action]) => {
        try { globalShortcut.register(key, () => sendPlayerAction(action)); } catch (e) {}
    });
});

// ==================== 后端进程管理 ====================
// ==================== macOS 应用菜单 ====================
// macOS 应用必须有顶层菜单，否则顶栏显示 "Electron"。
// Windows / Linux 无系统级应用菜单，此函数直接返回。
function createApplicationMenu() {
    if (process.platform !== 'darwin') return;
    const { Menu } = require('electron');
    const appName = app.getName();
    const template = [
        {
            label: appName,
            submenu: [
                { role: 'about', label: `关于 ${appName}` },
                { type: 'separator' },
                { role: 'services', label: '服务' },
                { type: 'separator' },
                { role: 'hide', label: `隐藏 ${appName}` },
                { role: 'hideOthers', label: '隐藏其他' },
                { role: 'unhide', label: '显示全部' },
                { type: 'separator' },
                { role: 'quit', label: `退出 ${appName}` },
            ],
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '重做' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                { role: 'selectAll', label: '全选' },
            ],
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '重新加载' },
                { role: 'forceReload', label: '强制重新加载' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' },
            ],
        },
        {
            label: '窗口',
            role: 'window',
            submenu: [
                { role: 'minimize', label: '最小化' },
                { role: 'zoom', label: '缩放' },
                { type: 'separator' },
                { role: 'front', label: '前置全部窗口' },
            ],
        },
    ];
    try {
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } catch (e) {
        console.warn('设置 macOS 应用菜单失败:', e);
    }
}

function killBackendProcess() {
    if (!pythonProcess || pythonProcess.killed) { pythonProcess = null; return; }
    const pid = pythonProcess.pid;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
        } else {
            // POSIX：以 detached:true 启动，子进程是进程组 leader（pgid == pid）。
            // 给整组发信号，确保 uvicorn 派生的子进程也一起退出。
            try { process.kill(-pid, 'SIGTERM'); }
            catch (e) { try { pythonProcess.kill('SIGTERM'); } catch (e2) {} }
            setTimeout(() => {
                try { process.kill(-pid, 'SIGKILL'); } catch (e) {}
                try { pythonProcess && pythonProcess.kill('SIGKILL'); } catch (e) {}
            }, 2000);
        }
    } catch (e) {}
    pythonProcess = null;
}

function startPythonBackend(port, dataDir) {
    try {
        const rootDir = path.join(__dirname, '..');
        let pythonCmd, serverScript, backendCwd;

        if (app.isPackaged) {
            const backendDir = path.join(process.resourcesPath, 'backend');
            const exeName = process.platform === 'win32' ? 'cyy_backend.exe' : 'cyy_backend';
            pythonCmd = path.join(backendDir, exeName);
            serverScript = null;
            backendCwd = dataDir || backendDir;
            if (!fs.existsSync(pythonCmd)) {
                const err = `找不到后端可执行文件 ${pythonCmd}`;
                console.error(err);
                backendLastError = err;
                return { ok: false, error: err };
            }
        } else {
            serverScript = path.join(rootDir, 'server.py');
            backendCwd = rootDir;
            const isWin = process.platform === 'win32';
            const venvCandidates = isWin
                ? [path.join(rootDir, 'cmcol', 'Scripts', 'python.exe')]
                : [path.join(rootDir, 'cmcol', 'bin', 'python3'),
                   path.join(rootDir, 'cmcol', 'bin', 'python')];
            let python = isWin ? 'python' : 'python3';
            for (const c of venvCandidates) {
                if (fs.existsSync(c)) { python = c; break; }
            }
            if (python === 'python' || python === 'python3') {
                console.warn('未找到虚拟环境，使用系统 Python');
            }
            pythonCmd = python;
            if (!fs.existsSync(serverScript)) {
                const err = '找不到 server.py，请确保它在项目根目录';
                console.error(err);
                backendLastError = err;
                return { ok: false, error: err };
            }
        }

        console.log(`正在启动后端: ${pythonCmd}${serverScript ? ' ' + serverScript : ''} (port ${port})`);

        const env = Object.assign({}, process.env);
        if (dataDir) { env.CMC_DATA_DIR = dataDir; console.log(`数据目录: ${dataDir}`); }
        env.CMC_API_PORT = String(port);
        env.PYTHONIOENCODING = 'utf-8';    // 跨平台统一 stdout/stderr 编码

        const spawnOpts = {
            cwd: backendCwd, stdio: 'inherit', shell: false, env, windowsHide: true,
        };
        // POSIX：detached=true 让后端成为独立进程组 leader，便于整组 kill
        if (process.platform !== 'win32') spawnOpts.detached = true;

        pythonProcess = spawn(pythonCmd, serverScript ? [serverScript] : [], spawnOpts);

        backendStartTime = Date.now();
        backendLastError = null;

        pythonProcess.on('error', (err) => {
            const msg = `启动后端失败: ${err.message || err}`;
            console.error(msg);
            backendLastError = msg;
            notifyBackendFailed(msg);
        });

        pythonProcess.on('exit', (code) => {
            console.log(`后端进程退出，代码: ${code}`);
            pythonProcess = null;
            handleBackendExit(code);
        });

        return { ok: true };
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        console.error('startPythonBackend 异常:', msg);
        backendLastError = msg;
        return { ok: false, error: msg };
    }
}

/** 通知渲染进程端口变化（新端口写进前端全局 API_BASE / WS_URL）。 */
function notifyApiPortChanged(newPort) {
    const payload = { port: newPort };
    [mainWindow, miniWindow, desktopLyricWindow].forEach(w => {
        if (w && !w.isDestroyed()) {
            try { w.webContents.send('api-port-changed', payload); } catch (e) {}
        }
    });
}

function handleBackendExit(code) {
    if (backendReadyTimer) { clearInterval(backendReadyTimer); backendReadyTimer = null; }
    if (isQuitting) return;
    if (code === 0) return;

    const ranFor = Date.now() - backendStartTime;
    if (ranFor > 60000) {
        console.log(`后端运行 ${Math.round(ranFor / 1000)}s 后崩溃，重置连续崩溃计数`);
        backendCrashCount = 0;
    }

    if (backendCrashCount >= MAX_BACKEND_RESTARTS) {
        const msg = `后端已连续 ${MAX_BACKEND_RESTARTS} 次启动失败，已停止自动重启。${backendLastError ? ' 最后错误：' + backendLastError : ''}`;
        console.error(msg);
        notifyBackendFailed(msg);
        return;
    }

    backendCrashCount += 1;
    const delayMs = Math.pow(3, backendCrashCount - 1) * 1000;
    console.log(`后端第 ${backendCrashCount}/${MAX_BACKEND_RESTARTS} 次重启，${delayMs}ms 后执行`);

    backendRestartTimer = setTimeout(async () => {
        backendRestartTimer = null;
        if (isQuitting) return;

        // 连续失败 2 次以上，重新探测端口；
        // 若新端口与旧不同，通知渲染进程更新 API_BASE。
        if (backendCrashCount >= 2) {
            try {
                const newPort = await findAvailablePort(DEFAULT_API_PORT);
                if (newPort && newPort !== apiPort) {
                    console.log(`切换端口: ${apiPort} → ${newPort}`);
                    apiPort = newPort;
                    process.env.CMC_API_PORT = String(newPort);
                    notifyApiPortChanged(newPort);
                }
            } catch (e) {
                console.warn('重新探测端口失败，沿用原端口:', e);
            }
        }

        const result = startPythonBackend(apiPort, getDataDir());
        if (result.ok) logBackendReady(apiPort);
        else { backendLastError = result.error; handleBackendExit(-1); }
    }, delayMs);
}

function logBackendReady(port) {
    if (backendReadyTimer) clearInterval(backendReadyTimer);
    let attempts = 0;
    backendReadyTimer = setInterval(async () => {
        attempts += 1;
        try {
            const resp = await fetch(`http://127.0.0.1:${port}`);
            if (resp.ok) {
                clearInterval(backendReadyTimer);
                backendReadyTimer = null;
                backendCrashCount = 0;
                backendLastError = null;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('backend-restored', { port });
                }
                console.log('后端已就绪');
            }
        } catch (e) {}
        if (attempts >= 120) {
            clearInterval(backendReadyTimer);
            backendReadyTimer = null;
            const msg = '后端在 60 秒内未响应健康检查';
            backendLastError = msg;
            notifyBackendFailed(msg);
        }
    }, 500);
}

function notifyBackendFailed(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-failed', {
            message, crashCount: backendCrashCount, maxRestarts: MAX_BACKEND_RESTARTS,
        });
    }
}

ipcMain.handle('get-backend-status', () => ({
    running: pythonProcess !== null && !pythonProcess.killed,
    crashCount: backendCrashCount,
    maxRestarts: MAX_BACKEND_RESTARTS,
    lastError: backendLastError,
    apiPort,
}));

ipcMain.handle('retry-backend', async () => {
    if (backendRestartTimer) { clearTimeout(backendRestartTimer); backendRestartTimer = null; }
    killBackendProcess();
    backendCrashCount = 0;
    backendLastError = null;

    // 重试时也顺手检查端口是否仍然可用
    try {
        const probe = await findAvailablePort(DEFAULT_API_PORT);
        if (probe === null) {
            const msg = `端口 ${DEFAULT_API_PORT}-${DEFAULT_API_PORT + PORT_SCAN_RANGE - 1} 全部被占用，无法启动后端`;
            backendLastError = msg;
            notifyBackendFailed(msg);
            return { ok: false, error: msg };
        }
        if (probe !== apiPort) {
            console.log(`重试时端口切换: ${apiPort} → ${probe}`);
            apiPort = probe;
            process.env.CMC_API_PORT = String(probe);
            notifyApiPortChanged(probe);
        }
    } catch (e) {}

    const result = startPythonBackend(apiPort, getDataDir());
    if (result.ok) { logBackendReady(apiPort); return { ok: true }; }
    backendLastError = result.error;
    notifyBackendFailed(result.error);
    return { ok: false, error: result.error };
});

ipcMain.handle('reset-window-state', () => {
    try {
        // 1) 关闭子窗口。
        //    它们的 close 事件会把当前几何写回内存缓存 —— 下一步会清空，
        //    所以这里的写入是"脏数据"，正好被清掉。
        if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
        if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) desktopLyricWindow.close();

        // 2) 清内存缓存 + 删磁盘文件
        _windowStateCache = {};
        const p = _getWindowStatePath();
        if (fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
        }

        // 3) 把主窗口拉回默认位置与尺寸
        //    必须做这一步：否则主窗口仍在旧位置，应用退出时 close 监听器
        //    会把旧几何写回文件，重启又是旧位置。
        //    居中逻辑与 createWindow 的默认值保持一致（1200×800）。
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                if (mainWindow.isMaximized()) mainWindow.unmaximize();
            } catch (e) {}
            try {
                const { screen } = require('electron');
                const wa = screen.getPrimaryDisplay().workArea;
                const W = 1200, H = 800;
                const x = Math.floor(wa.x + (wa.width - W) / 2);
                const y = Math.floor(wa.y + (wa.height - H) / 2);
                mainWindow.setBounds({ x, y, width: W, height: H });
            } catch (e) {}
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

// ==================== 诊断包导出 ====================
function collectLogs(logsDir, maxBytesPerFile = 512 * 1024) {
    const out = {};
    if (!fs.existsSync(logsDir)) return out;
    const walk = (dir, prefix) => {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full, prefix + entry.name + '/');
                else if (entry.isFile()) {
                    try {
                        const stat = fs.statSync(full);
                        const buf = fs.readFileSync(full);
                        let content = buf.toString('utf-8');
                        let truncated = false;
                        if (buf.length > maxBytesPerFile) {
                            content = content.slice(-maxBytesPerFile);
                            truncated = true;
                        }
                        out[prefix + entry.name] = { size: stat.size, truncated, content };
                    } catch (e) { out[prefix + entry.name] = { error: String(e) }; }
                }
            }
        } catch (e) {}
    };
    walk(logsDir, '');
    return out;
}

ipcMain.handle('export-diagnostics', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出诊断包',
        defaultPath: `cyy-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    try {
        const dataDir = getDataDir() || path.join(__dirname, '..');
        const payload = {
            generated_at: new Date().toISOString(),
            app: {
                version: app.getVersion(), packaged: app.isPackaged,
                platform: process.platform, arch: process.arch,
                electron: process.versions.electron, node: process.versions.node,
                chrome: process.versions.chrome,
            },
            backend: {
                api_port: apiPort, crash_count: backendCrashCount,
                last_error: backendLastError, running: pythonProcess !== null,
            },
            window_state: loadWindowState(),
        };
        try {
            const resp = await fetch(`http://127.0.0.1:${apiPort}/diagnostics`);
            if (resp.ok) payload.diagnostics = await resp.json();
            else payload.diagnostics_error = `HTTP ${resp.status}`;
        } catch (e) { payload.diagnostics_error = String(e); }
        payload.logs = collectLogs(path.join(dataDir, 'logs'), 512 * 1024);
        fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
        return { ok: true, filePath: result.filePath };
    } catch (e) { return { ok: false, error: String(e) }; }
});

// ==================== 应用生命周期 ====================
app.whenReady().then(async () => {
    createApplicationMenu();
    const found = await findAvailablePort(DEFAULT_API_PORT);
    if (found === null) {
        dialog.showErrorBox(
            '无法启动后端',
            `端口 ${DEFAULT_API_PORT}-${DEFAULT_API_PORT + PORT_SCAN_RANGE - 1} 全部被占用。\n` +
            `请关闭占用这些端口的程序后重试。`
        );
        app.quit();
        return;
    }
    apiPort = found;
    process.env.CMC_API_PORT = String(apiPort);
    console.log(`后端端口: ${apiPort}`);

    const dataDir = getDataDir();
    if (dataDir) { process.env.CMC_DATA_DIR = dataDir; console.log(`数据目录: ${dataDir}`); }

    // 先拿到端口再创建窗口，保证 additionalArguments 注入正确
    createWindow(apiPort);

    const lanIP = getLanIPv4();
    if (lanIP) {
        console.log(`局域网访问: http://${lanIP}:${apiPort}/`);
        process.env.CMC_LAN_IP = lanIP;
    } else {
        console.log('未检测到局域网 IPv4 地址，遥控/投送功能不可用');
    }

    const result = startPythonBackend(apiPort, dataDir);
    if (result.ok) logBackendReady(apiPort);
    else notifyBackendFailed(result.error);
});

function getLanIPv4() {
    const os = require('os');
    const ifs = os.networkInterfaces();
    // 排除常见虚拟网卡 / VPN
    const VIRTUAL_RE = /(vmware|virtualbox|vethernet|hyper-?v|loopback|wsl|docker|tap|tun|vpn|zerotier|hamachi|bridge|utun|llw|awdl)/i;
    // 真实网卡关键词（含 macOS 的 en0/en1、Linux 的 eth0/wlan0）
    const REAL_RE = /(wi-?fi|wlan|ethernet|以太网|无线|本地连接|^en\d+|^eth\d+)/i;

    const candidates = [];
    for (const name of Object.keys(ifs)) {
        for (const info of ifs[name] || []) {
            if (info.family !== 'IPv4' || info.internal) continue;
            // 排除虚拟网卡典型的 .1 地址（宿主机端）
            candidates.push({ name, address: info.address });
        }
    }

    // 1) 网卡名像真实网卡，且不像虚拟网卡 → 最可信
    let hit = candidates.find(c => REAL_RE.test(c.name) && !VIRTUAL_RE.test(c.name));
    // 2) 退一步：不像虚拟网卡，且地址不以 .1 结尾（.1 通常是网关/虚拟端）
    if (!hit) hit = candidates.find(c => !VIRTUAL_RE.test(c.name) && !c.address.endsWith('.1'));
    // 3) 再退：只是不像虚拟网卡
    if (!hit) hit = candidates.find(c => !VIRTUAL_RE.test(c.name));
    // 4) 兜底
    if (!hit) hit = candidates.find(c => !c.address.endsWith('.1'));
    if (!hit) hit = candidates[0];

    console.log('可用网卡:', candidates.map(c => `${c.name}=${c.address}`).join(', '));
    console.log('选定局域网 IP:', hit ? `${hit.name}=${hit.address}` : '(无)');
    return hit ? hit.address : null;
}

app.on('before-quit', () => {
    isQuitting = true;
    try { globalShortcut.unregisterAll(); } catch (e) {}
    if (backendRestartTimer) { clearTimeout(backendRestartTimer); backendRestartTimer = null; }
    if (backendReadyTimer) { clearInterval(backendReadyTimer); backendReadyTimer = null; }
    // 双保险：各窗口 close 已写盘，此处再 flush 一次确保落盘（幂等，无副作用）
    _flushWindowState();
});

app.on('window-all-closed', () => {
    if (process.platform === 'darwin') {
        // macOS：窗口全关后应用继续驻留（后端保持运行），由用户从 Dock 重新打开
        return;
    }
    if (pythonProcess) {
        console.log('正在关闭后端...');
        killBackendProcess();
    }
    app.quit();
});

// macOS：点击 Dock 图标时若无窗口则重建（复用已有后端端口）
app.on('activate', () => {
    if (process.platform !== 'darwin') return;
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(apiPort);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    }
});