// ==================== cYy Music Client 渲染进程入口 ====================
// 所有功能模块已按职责拆分到 js/ 目录，此文件仅负责启动顺序。
// 各模块依赖关系与加载顺序见 index.html 底部的 script 标签。

// 隐藏 <audio>（保留元素用于播放，但不显示默认控件）
audioPlayer.style.display = 'none';

// 建立 WebSocket 连接（接收下载/搜索/解析进度）
connectWebSocket();

// 启动底部迷你频谱绘制循环
drawMiniSpectrum();

// 应用初始化：拉取设置与选项，填充 UI，触发入场动画
initApp();