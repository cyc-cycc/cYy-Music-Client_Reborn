// ==================== 睡眠定时器 ====================
(function () {
  const btn = document.getElementById('btn-sleep-timer');
  const menu = document.getElementById('sleep-timer-menu');
  const remainingEl = document.getElementById('sleep-timer-remaining');
  if (!btn || !menu) return;

  const PRESETS = [
    { min: 15, label: '15 分钟' },
    { min: 30, label: '30 分钟' },
    { min: 45, label: '45 分钟' },
    { min: 60, label: '60 分钟' },
    { min: 90, label: '90 分钟' },
    { min: -1, label: '自定义…' },
    { min: 0,  label: '关闭定时' },
  ];

  menu.innerHTML = '';
  PRESETS.forEach(({ min, label }) => {
    const item = document.createElement('button');
    item.className = 'sleep-item';
    item.type = 'button';
    item.textContent = label;
    item.addEventListener('click', () => {
      if (min === -1) {
        promptCustom();
      } else if (min === 0) {
        stopTimer(true);
      } else {
        startTimer(min);
      }
      hideMenu();
    });
    menu.appendChild(item);
  });

  let tickId = null;
  let endsAt = 0;

  function promptCustom() {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:12px;padding:20px 24px;max-width:360px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
    box.innerHTML = `
      <div style="font-weight:bold;margin-bottom:10px;">自定义睡眠时长</div>
      <div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:10px;">
        请输入分钟数（支持小数，最大 720 分钟）
      </div>
      <input type="number" id="sleep-custom-input" min="0.1" max="720" step="0.5" value="25"
             style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-text);font-size:14px;outline:none;box-sizing:border-box;" />
      <div style="text-align:right;margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="sleep-custom-cancel" style="padding:6px 16px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);cursor:pointer;">取消</button>
        <button type="button" id="sleep-custom-ok" style="padding:6px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;">确定</button>
      </div>
    `;
    mask.appendChild(box);
    document.body.appendChild(mask);

    const input = box.querySelector('#sleep-custom-input');
    const okBtn = box.querySelector('#sleep-custom-ok');
    const cancelBtn = box.querySelector('#sleep-custom-cancel');

    const close = () => mask.remove();
    const confirm = () => {
      const m = parseFloat(input.value);
      if (isNaN(m) || m <= 0) { setStats('无效的定时时长'); input.focus(); return; }
      if (m > 720) { setStats('定时时长不能超过 720 分钟'); input.focus(); return; }
      close();
      startTimer(m);
    };

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  function startTimer(minutes) {
    stopTimer(false);
    endsAt = Date.now() + minutes * 60000;
    btn.classList.add('active');
    tickId = setInterval(update, 1000);
    update();
    setStats(`睡眠定时器已启动：${fmtLabel(minutes)}后停止`);
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function fmtLabel(m) {
    return Number.isInteger(m) ? `${m} 分钟` : `${m.toFixed(1)} 分钟`;
  }

  function stopTimer(announce) {
    if (tickId) { clearInterval(tickId); tickId = null; }
    endsAt = 0;
    btn.classList.remove('active');
    btn.title = '睡眠定时器';
    if (remainingEl) {
      remainingEl.classList.remove('show');
      remainingEl.textContent = '';
    }
    if (announce) setStats('睡眠定时器已关闭');
  }

  function update() {
    const remaining = Math.max(0, endsAt - Date.now());
    const totalSec = Math.floor(remaining / 1000);
    const hh = Math.floor(totalSec / 3600);
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const timeStr = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
    btn.title = `睡眠定时器：${timeStr} 后停止`;
    if (remainingEl) {
      remainingEl.textContent = timeStr;
      remainingEl.classList.add('show');
    }
    if (remaining <= 0) fire();
  }

  function fire() {
    stopTimer(false);
    if (typeof stopPlayback === 'function') stopPlayback();
    setStats('睡眠定时器已触发，播放已停止');
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('cYy Music', { body: '睡眠定时器已到点，播放已停止' });
      }
    } catch (e) {}
  }

  function showMenu() { menu.classList.add('show'); }
  function hideMenu() { menu.classList.remove('show'); }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('show')) hideMenu();
    else showMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) hideMenu();
  });
})();