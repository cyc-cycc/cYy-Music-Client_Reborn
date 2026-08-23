// frontend/main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

require('@electron/remote/main').initialize();

let mainWindow = null;
let pythonProcess = null;

const isDev = process.env.NODE_ENV === 'development';
const BACKEND_URL = 'http://127.0.0.1:8000';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 700,
        frame: false,
        transparent: true,
        hasShadow: false,
        show: false, // ← 关键：默认隐藏，等待渲染进程通知
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
    });

    require('@electron/remote/main').enable(mainWindow.webContents);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // 监听渲染进程发送的 "window-ready-to-show" 信号
    ipcMain.once('window-ready-to-show', () => {
        // 用户可能已手动最小化窗口（最小化时 isVisible() 为 false），此时不要强制弹出
        if (mainWindow && !mainWindow.isVisible() && !mainWindow.isMinimized()) {
            mainWindow.show();
        }
    });

    // 如果 5 秒后仍未收到信号，强制显示（避免卡死；同样尊重用户已最小化）
    setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible() && !mainWindow.isMinimized()) {
            mainWindow.show();
        }
    }, 5000);

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 计算数据目录（配置/日志/下载/musicdl 缓存 都放这里）：
// - 便携版：electron-builder 注入的 PORTABLE_EXECUTABLE_DIR，即便携 exe 所在目录
// - 安装版（NSIS）/解包版：userData（如 %APPDATA%\cyy-music-client），避免写入安装目录（如 Program Files）失败
// - 开发模式：不设置（后端默认使用项目根目录）
function getDataDir() {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        // 便携版：数据放在 exe 同目录
        return process.env.PORTABLE_EXECUTABLE_DIR;
    }
    if (app.isPackaged) {
        // 安装版（NSIS）：使用用户数据目录（例如 C:\Users\用户名\AppData\Roaming\cyy-music-client）
        return app.getPath('userData');
    }
    // 开发模式：使用项目根目录
    return null;
}

function startPythonBackend() {
    const rootDir = path.join(__dirname, '..');
    const isPackaged = app.isPackaged;
    const dataDir = getDataDir();
    let pythonCmd, serverScript, backendCwd;

	if (isPackaged) {
		let backendDir;
		if (process.platform === 'win32') {
			// Windows: 后端在 resources/backend（通过 extraResources）
			backendDir = path.join(process.resourcesPath, 'backend');
		} else {
			// macOS/Linux: 后端在 app.asar.unpacked/backend（通过 files + asarUnpack）
			backendDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'backend');
		}
		const backendExe = process.platform === 'win32' ? 'cyy_backend.exe' : 'cyy_backend';
		pythonCmd = path.join(backendDir, backendExe);
		serverScript = null;
		backendCwd = dataDir || backendDir;
		if (!fs.existsSync(pythonCmd)) {
			console.error(`错误：找不到后端可执行文件 ${pythonCmd}`);
			return;
		}
		// macOS/Linux 需要执行权限
		if (process.platform !== 'win32') {
			try { fs.chmodSync(pythonCmd, 0o755); } catch (e) {}
		}
	} else {
        // 开发模式：运行 python server.py
        serverScript = path.join(rootDir, 'server.py');
        backendCwd = rootDir;
        let python = 'python';
        const venvDir = path.join(rootDir, 'cmcol');
        if (process.platform === 'win32') {
            const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
            if (fs.existsSync(venvPython)) {
                python = venvPython;
            } else {
                console.warn('未找到虚拟环境，使用系统 Python');
            }
        } else {
            const venvPython = path.join(venvDir, 'bin', 'python');
            if (fs.existsSync(venvPython)) {
                python = venvPython;
            } else {
                console.warn('未找到虚拟环境，使用系统 Python3');
                python = 'python3';
            }
        }
        pythonCmd = python;
        if (!fs.existsSync(serverScript)) {
            console.error('错误：找不到 server.py，请确保它在项目根目录');
            return;
        }
    }

    console.log(`正在启动后端: ${pythonCmd}${serverScript ? ' ' + serverScript : ''}`);

    // 数据目录通过环境变量传给后端（constants.DATA_DIR 优先读取 CMC_DATA_DIR）
    const env = Object.assign({}, process.env);
    if (dataDir) {
        env.CMC_DATA_DIR = dataDir;
        console.log(`数据目录: ${dataDir}`);
    }

    pythonProcess = spawn(pythonCmd, serverScript ? [serverScript] : [], {
        cwd: backendCwd,
        stdio: 'inherit',
        shell: false,
        env,
        windowsHide: true,   // 隐藏 Python 控制台窗口（开发模式同样生效）
    });

    pythonProcess.on('error', (err) => {
        console.error('启动后端失败:', err);
    });

    pythonProcess.on('exit', (code) => {
        console.log(`后端进程退出，代码: ${code}`);
        pythonProcess = null;
    });
}

// 后台探测后端就绪（仅日志；不再阻塞窗口显示，前端会持续重试连接）
function logBackendReady() {
    const timer = setInterval(async () => {
        try {
            const resp = await fetch(BACKEND_URL);
            if (resp.ok) {
                clearInterval(timer);
                console.log('后端已就绪');
            }
        } catch (e) { /* 未就绪 */ }
    }, 500);
}

app.whenReady().then(() => {
    // 设置数据目录环境变量，供渲染进程使用（修复 NSIS 安装版主题闪烁）
    const dataDir = getDataDir();
    if (dataDir) {
        process.env.CMC_DATA_DIR = dataDir;
        console.log(`数据目录已注入环境变量: ${dataDir}`);
    }

    startPythonBackend();
    logBackendReady();
    createWindow();
});

app.on('window-all-closed', () => {
    if (pythonProcess) {
        console.log('正在关闭后端...');
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', pythonProcess.pid, '/f', '/t']);
        } else {
            pythonProcess.kill('SIGINT');
        }
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
