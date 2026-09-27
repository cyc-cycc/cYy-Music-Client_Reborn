// ==================== 均衡器、频谱、可视化 ====================

// ---------- 均衡器数据 ----------
const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop:       [-1, 2, 4, 5, 3, 0, -1, -1, 0, 1],
  rock:      [5, 4, 2, 1, 0, -1, -1, 1, 2, 3],
  jazz:      [3, 2, 1, 0, 0, 0, -1, 0, 1, 2],
  classical: [4, 3, 1, 0, 0, 0, 0, 1, 3, 4],
  vocal:     [-3, -2, 0, 2, 4, 5, 4, 1, 0, -2],
  bass:      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  cYy:       [1.5, 6, 6.5, 5.5, 1, -5, 3, 0, 3, 1]
};
function defaultEq() {
  return {
    bands: EQ_PRESETS.flat.slice(),
    bass: false, treble: false, vocal: false,
    vocal_cancel: false,
    vocal_cancel_amount: 100,   // 0-100，人声消除强度
    preset: 'flat',
  };
}

// ---------- 自定义 DOM 输入/确认弹窗（替代 Electron 不可用的 prompt/confirm） ----------
function promptInput(title, defaultValue = '', hint = '') {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:12px;padding:20px 24px;max-width:420px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
    box.innerHTML = `
      <div style="font-weight:bold;margin-bottom:10px;">${escapeHtml(title)}</div>
      ${hint ? `<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px;line-height:1.5;">${escapeHtml(hint)}</div>` : ''}
      <input type="text" id="__prompt_input" value="${escapeHtml(defaultValue)}"
             style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-text);font-size:14px;outline:none;box-sizing:border-box;" />
      <div style="text-align:right;margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="__prompt_cancel" style="padding:6px 16px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);cursor:pointer;">取消</button>
        <button type="button" id="__prompt_ok" style="padding:6px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;">确定</button>
      </div>
    `;
    mask.appendChild(box);
    document.body.appendChild(mask);

    const input = box.querySelector('#__prompt_input');
    const okBtn = box.querySelector('#__prompt_ok');
    const cancelBtn = box.querySelector('#__prompt_cancel');

    const cleanup = () => mask.remove();
    const doOk = () => { const v = input.value; cleanup(); resolve(v); };
    const doCancel = () => { cleanup(); resolve(null); };

    okBtn.addEventListener('click', doOk);
    cancelBtn.addEventListener('click', doCancel);
    mask.addEventListener('click', (e) => { if (e.target === mask) doCancel(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

function promptConfirm(title, text) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:12px;padding:20px 24px;max-width:400px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
    box.innerHTML = `
      <div style="font-weight:bold;margin-bottom:8px;">${escapeHtml(title)}</div>
      <div style="white-space:pre-line;font-size:13px;color:var(--color-text-secondary);margin-bottom:14px;line-height:1.6;">${escapeHtml(text)}</div>
      <div style="text-align:right;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="__confirm_cancel" style="padding:6px 16px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);cursor:pointer;">取消</button>
        <button type="button" id="__confirm_ok" style="padding:6px 18px;border-radius:8px;border:none;background:var(--color-danger);color:#fff;cursor:pointer;">确定</button>
      </div>
    `;
    mask.appendChild(box);
    document.body.appendChild(mask);

    const cleanup = () => mask.remove();
    const doOk = () => { cleanup(); resolve(true); };
    const doCancel = () => { cleanup(); resolve(false); };

    box.querySelector('#__confirm_ok').addEventListener('click', doOk);
    box.querySelector('#__confirm_cancel').addEventListener('click', doCancel);
    mask.addEventListener('click', (e) => { if (e.target === mask) doCancel(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler, true);
        doCancel();
      }
    }, true);
    setTimeout(() => box.querySelector('#__confirm_ok').focus(), 50);
  });
}

// ---------- 自定义均衡器预设管理 ----------
let _customPresets = [];  // [{name, bands, bass, treble, vocal, vocal_cancel, vocal_cancel_amount, preamp}, ...]

async function loadCustomPresets() {
  try {
    const data = await fetch(`${API_BASE}/eq/presets`).then(r => r.json());
    _customPresets = (data && data.user) || [];
  } catch (e) {
    console.warn('加载自定义预设失败:', e);
    _customPresets = [];
  }
  renderPresetOptions();
}

function renderPresetOptions() {
  const sel = eqPreset;
  if (!sel) return;
  // 移除旧的自定义 option
  [...sel.querySelectorAll('option[data-custom="1"]')].forEach(o => o.remove());
  // 插入到 "自定义" 之前
  const customOpt = sel.querySelector('option[value="custom"]');
  _customPresets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = 'user:' + p.name;
    opt.textContent = '★ ' + p.name;
    opt.dataset.custom = '1';
    if (customOpt) sel.insertBefore(opt, customOpt);
    else sel.appendChild(opt);
  });
  // 同步当前值
  syncPresetSelectValue();
}

function syncPresetSelectValue() {
  const sel = eqPreset;
  if (!sel) return;
  const cur = (state.eq && state.eq.preset) || 'custom';
  const has = [...sel.options].some(o => o.value === cur);
  sel.value = has ? cur : 'custom';
}

function findCustomPreset(name) {
  return _customPresets.find(p => p.name === name) || null;
}

function applyCustomPresetByName(name) {
  const p = findCustomPreset(name);
  if (!p) return false;
  state.eq = {
    bands: (p.bands || EQ_PRESETS.flat).slice(),
    bass: !!p.bass,
    treble: !!p.treble,
    vocal: !!p.vocal,
    vocal_cancel: !!p.vocal_cancel,
    vocal_cancel_amount: (p.vocal_cancel_amount != null) ? p.vocal_cancel_amount : 100,
    preset: 'user:' + name,
  };
  syncEqUI();
  applyEqToGraph();
  persistSetting({ eq: state.eq });
  return true;
}

function _currentPresetPayload(name) {
  const eq = state.eq || defaultEq();
  return {
    name,
    version: 1,
    bands: (eq.bands || EQ_PRESETS.flat).slice(),
    bass: !!eq.bass,
    treble: !!eq.treble,
    vocal: !!eq.vocal,
    vocal_cancel: !!eq.vocal_cancel,
    vocal_cancel_amount: (eq.vocal_cancel_amount != null) ? eq.vocal_cancel_amount : 100,
    preamp: 0,
  };
}

async function _postPreset(payload) {
  const r = await fetch(`${API_BASE}/eq/presets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: JSON.stringify(payload) }),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j && j.detail) msg = j.detail; }
    catch (e) { /* 保持默认 */ }
    throw new Error(msg);
  }
  return r.json();
}

async function saveCurrentAsPreset() {
  const raw = await promptInput(
    '保存均衡器预设',
    '',
    '预设名称：1–60 字符，可含中文、空格、常见符号（. - + ( ) [ ]）'
  );
  if (raw == null) return;
  const name = String(raw).trim();
  if (!name) {
    setStats('预设名称不能为空');
    return;
  }
  try {
    await _postPreset(_currentPresetPayload(name));
    setStats(`预设已保存：${name}`);
    await loadCustomPresets();
    applyCustomPresetByName(name);
  } catch (e) {
    setStats(`保存失败：${e.message}`);
    showWarn('保存失败', String(e.message || e));
  }
}

async function importPresetFromFile() {
  if (!win || !dialog || !fs) {
    setStats('导入预设需要 Electron 环境');
    return;
  }
  const result = await dialog.showOpenDialog({
    title: '导入均衡器预设',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return;
  try {
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const r = await fetch(`${API_BASE}/eq/presets/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    setStats(`已导入预设：${data.name}`);
    await loadCustomPresets();
    applyCustomPresetByName(data.name);
  } catch (e) {
    setStats(`导入失败：${e.message}`);
    showWarn('导入失败', String(e.message || e));
  }
}

async function exportCurrentPreset() {
  if (!win || !dialog || !fs) {
    setStats('导出预设需要 Electron 环境');
    return;
  }
  const eq = state.eq || defaultEq();
  const cur = eq.preset || '';
  const defaultName = cur.startsWith('user:') ? cur.slice(5) : 'my-eq-preset';
  const result = await dialog.showSaveDialog({
    title: '导出均衡器预设',
    defaultPath: defaultName + '.json',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    fs.writeFileSync(
      result.filePath,
      JSON.stringify(_currentPresetPayload(defaultName), null, 2),
      'utf-8'
    );
    setStats(`预设已导出：${result.filePath}`);
  } catch (e) {
    setStats(`导出失败：${e.message}`);
  }
}

async function deleteSelectedPreset() {
  const v = eqPreset.value;
  if (!v.startsWith('user:')) {
    setStats('只能删除自定义预设');
    return;
  }
  const name = v.slice(5);
  const ok = await promptConfirm('删除预设', `确定删除预设「${name}」？此操作不可恢复。`);
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/eq/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    setStats(`已删除预设：${name}`);
    await loadCustomPresets();
    state.eq = defaultEq();
    renderEqBands();
    syncEqUI();
    applyEqToGraph();
    persistSetting({ eq: state.eq });
  } catch (e) {
    setStats(`删除失败：${e.message}`);
  }
}

// 绑定新按钮（若元素存在）
(function bindPresetButtons() {
  const bSave = $('eq-preset-save');
  const bImport = $('eq-preset-import');
  const bExport = $('eq-preset-export');
  const bDelete = $('eq-preset-delete');
  if (bSave) bSave.addEventListener('click', saveCurrentAsPreset);
  if (bImport) bImport.addEventListener('click', importPresetFromFile);
  if (bExport) bExport.addEventListener('click', exportCurrentPreset);
  if (bDelete) bDelete.addEventListener('click', deleteSelectedPreset);
})();

// 平滑过渡时间常数（秒）：约 3τ ≈ 90ms 到达目标值
const VOCAL_RAMP_TC = 0.03;

// ---------- 音频图（源 → EQ 链 → 分析器 → 输出） ----------
function ensureAudioGraph() {
  if (state.audioCtx) {
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    return;
  }
  // 若存在旧的单声道检测定时器（audioCtx 被外部释放等情况），先清理
  if (state.vocalCancel && state.vocalCancel._monoTimer) {
    clearInterval(state.vocalCancel._monoTimer);
    state.vocalCancel._monoTimer = null;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  state.audioCtx = new AC();
  state.srcNode = state.audioCtx.createMediaElementSource(audioPlayer);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 2048;
  state.analyser.smoothingTimeConstant = 0.7;
  const mk = (type, freq, Q = 1.1) => {
    const f = state.audioCtx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    f.gain.value = 0;
    return f;
  };
  state.eqExtra = {
    bass: mk('lowshelf', 120),
    treble: mk('highshelf', 8000),
    vocal: mk('peaking', 1500, 1.0),
  };
  state.eqFilters = EQ_BANDS.map(freq => mk('peaking', freq));

  // ---- 人声消除（中置声道反相：L − R）+ 低频保留 + 可调强度 + 单声道检测 ----
  // 结构：
  //   src ──► dryGain(1-amount) ────────────────────────────────────► eqExtra.bass
  //   src ──► splitter ─► L(+1),R(-1) ─► merger ─► bandpass ─► wetGain(amount) ─► bass
  //   src ──► lowKeep(lowpass 200Hz) ─► lowGain(amount) ────────────► bass
  //   src ──► detectSplitter ─► detectL, detectR  （仅用于单声道检测，不参与输出）
  //
  // amount=0 → 全信号；amount=1 → 中高频为 L−R 带通 + 低频完整保留
  const vocalSplitter = state.audioCtx.createChannelSplitter(2);
  const vocalMerger = state.audioCtx.createChannelMerger(2);
  const vocalL = state.audioCtx.createGain();
  const vocalR = state.audioCtx.createGain();
  vocalL.gain.value = 1;
  vocalR.gain.value = -1;
  vocalSplitter.connect(vocalL, 0);
  vocalSplitter.connect(vocalR, 1);
  vocalL.connect(vocalMerger, 0, 0);
  vocalR.connect(vocalMerger, 0, 0);
  vocalL.connect(vocalMerger, 0, 1);
  vocalR.connect(vocalMerger, 0, 1);

  // 带通：只处理人声主要频段（200Hz ~ 5kHz），避免把低音/超高频也反相
  const vocalBandpass = state.audioCtx.createBiquadFilter();
  vocalBandpass.type = 'bandpass';
  vocalBandpass.frequency.value = 1500;
  vocalBandpass.Q.value = 0.5;

  const vocalWetGain = state.audioCtx.createGain();
  vocalWetGain.gain.value = 0;

  const vocalDryGain = state.audioCtx.createGain();
  vocalDryGain.gain.value = 1;

  // 低频保留路：把 <200Hz 完整保留，避免 L−R 把低音也削掉
  const vocalLowKeep = state.audioCtx.createBiquadFilter();
  vocalLowKeep.type = 'lowpass';
  vocalLowKeep.frequency.value = 200;
  vocalLowKeep.Q.value = 0.707;
  const vocalLowGain = state.audioCtx.createGain();
  vocalLowGain.gain.value = 0;

  // 单声道检测（旁路）
  const detectSplitter = state.audioCtx.createChannelSplitter(2);
  const detectL = state.audioCtx.createAnalyser();
  const detectR = state.audioCtx.createAnalyser();
  detectL.fftSize = 512;
  detectR.fftSize = 512;
  detectL.smoothingTimeConstant = 0.3;
  detectR.smoothingTimeConstant = 0.3;

  // 连线
  state.srcNode.connect(vocalDryGain);
  vocalDryGain.connect(state.eqExtra.bass);

  state.srcNode.connect(vocalSplitter);
  vocalMerger.connect(vocalBandpass);
  vocalBandpass.connect(vocalWetGain);
  vocalWetGain.connect(state.eqExtra.bass);

  state.srcNode.connect(vocalLowKeep);
  vocalLowKeep.connect(vocalLowGain);
  vocalLowGain.connect(state.eqExtra.bass);

  state.srcNode.connect(detectSplitter);
  detectSplitter.connect(detectL, 0);
  detectSplitter.connect(detectR, 1);

  state.vocalCancel = {
    splitter: vocalSplitter, merger: vocalMerger,
    dry: vocalDryGain, wet: vocalWetGain,
    lowKeep: vocalLowKeep, lowGain: vocalLowGain,
    bandpass: vocalBandpass,
    detectL, detectR,
    amount: 0,
    detectedMono: false,
    _monoStreak: 0,
    _monoTimer: null,
  };

  // EQ 链
  let node = state.eqExtra.bass;
  node.connect(state.eqExtra.treble); node = state.eqExtra.treble;
  node.connect(state.eqExtra.vocal); node = state.eqExtra.vocal;
  for (const f of state.eqFilters) { node.connect(f); node = f; }
  node.connect(state.analyser);
  state.analyser.connect(state.audioCtx.destination);

  applyEqToGraph();
  startVocalMonoDetection();

  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
}

function applyEqToGraph() {
  if (!state.eqFilters || !state.audioCtx) return;
  const eq = state.eq || defaultEq();
  (eq.bands || EQ_PRESETS.flat.slice()).forEach((g, i) => {
    if (state.eqFilters[i]) state.eqFilters[i].gain.value = Math.max(-12, Math.min(12, Number(g) || 0));
  });
  if (state.eqExtra.bass) state.eqExtra.bass.gain.value = eq.bass ? 6 : 0;
  if (state.eqExtra.treble) state.eqExtra.treble.gain.value = eq.treble ? 4 : 0;
  if (state.eqExtra.vocal) state.eqExtra.vocal.gain.value = eq.vocal ? 4 : 0;

  // 人声消除：可调强度 + 平滑过渡（避免开关爆音）
  if (state.vocalCancel) {
    const enabled = !!eq.vocal_cancel;
    const raw = (eq.vocal_cancel_amount != null) ? eq.vocal_cancel_amount : 100;
    const amount = enabled ? Math.max(0, Math.min(1, raw / 100)) : 0;
    const now = state.audioCtx.currentTime;
    state.vocalCancel.dry.gain.setTargetAtTime(1 - amount, now, VOCAL_RAMP_TC);
    state.vocalCancel.wet.gain.setTargetAtTime(amount, now, VOCAL_RAMP_TC);
    state.vocalCancel.lowGain.gain.setTargetAtTime(amount, now, VOCAL_RAMP_TC);
    state.vocalCancel.amount = amount;
  }
}

// ---------- 单声道检测 + 提示 ----------
function startVocalMonoDetection() {
  const vc = state.vocalCancel;
  if (!vc || vc._monoTimer) return;
  vc._monoTimer = setInterval(() => {
    try {
      const { detectL, detectR } = vc;
      const bufL = new Uint8Array(detectL.frequencyBinCount);
      const bufR = new Uint8Array(detectR.frequencyBinCount);
      detectL.getByteFrequencyData(bufL);
      detectR.getByteFrequencyData(bufR);

      let sum = 0, dot = 0, nL = 0, nR = 0;
      for (let i = 0; i < bufL.length; i++) {
        const a = bufL[i], b = bufR[i];
        sum += a + b;
        dot += a * b;
        nL += a * a;
        nR += b * b;
      }
      // 静音/极弱段不做判断，避免误报
      if (sum < 200) return;
      const denom = Math.sqrt(nL * nR);
      const corr = denom > 0 ? dot / denom : 1;

      if (corr > 0.9995) {
        vc._monoStreak = (vc._monoStreak || 0) + 1;
        // 连续 5 次（≈4 秒）都极高相关，才认定为单声道源
        if (vc._monoStreak >= 5 && !vc.detectedMono) {
          vc.detectedMono = true;
          updateVocalCancelHint();
        }
      } else {
        vc._monoStreak = 0;
        // 相关性明显下降时，撤销单声道判定（避免歌曲内某段极静的误锁）
        if (vc.detectedMono && corr < 0.995) {
          vc.detectedMono = false;
          updateVocalCancelHint();
        }
      }
    } catch (e) { /* 忽略瞬时错误 */ }
  }, 800);
}

function updateVocalCancelHint() {
  const hint = $('eq-vocal-cancel-hint');
  if (!hint) return;
  const vc = state.vocalCancel;
  const eq = state.eq || defaultEq();
  if (!eq.vocal_cancel) {
    hint.textContent = '开启后削弱居中声源（如主唱）；对单声道源无效。';
    hint.classList.remove('warn');
    return;
  }
  if (vc && vc.detectedMono) {
    hint.textContent = '⚠ 检测到声道高度一致（疑似单声道源），消除后人声可能听不见。建议降低强度或关闭。';
    hint.classList.add('warn');
  } else {
    hint.textContent = '强度越高，居中声源削弱越明显；若听感变空请适当降低。';
    hint.classList.remove('warn');
  }
}

// ---------- 均衡器弹窗 ----------
function openEqModal() {
  if (!state.eq) state.eq = defaultEq();
  renderEqBands();
  loadCustomPresets();   // 异步加载；完成后会自动更新下拉框
  syncEqUI();
  openModal('eq-modal');
}
eqCloseBtn.addEventListener('click', () => closeModal('eq-modal'));
eqDoneBtn.addEventListener('click', () => closeModal('eq-modal'));
eqModal.addEventListener('click', (e) => { if (e.target.id === 'eq-modal') closeModal('eq-modal'); });
eqReset.addEventListener('click', () => {
  state.eq = defaultEq();
  renderEqBands();
  syncEqUI();
  applyEqToGraph();
  persistSetting({ eq: state.eq });
});

function renderEqBands() {
  const wrap = eqBands;
  if (!wrap || wrap.dataset.rendered) return;
  wrap.dataset.rendered = '1';
  EQ_BANDS.forEach((freq, i) => {
    const div = document.createElement('div');
    div.className = 'eq-band';
    const label = freq >= 1000 ? (freq / 1000) + 'K' : String(freq);
    div.innerHTML = `
      <span class="gain" id="eq-gain-${i}">0</span>
      <input type="range" min="-12" max="12" step="0.5" value="0" data-i="${i}" />
      <span class="freq">${label}</span>
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('input[type="range"]').forEach(input => {
    // input：只更新内存 + 音频图，避免拖动期间高频 POST
    input.addEventListener('input', () => {
      const i = Number(input.dataset.i);
      state.eq.bands[i] = Number(input.value);
      document.getElementById('eq-gain-' + i).textContent =
        input.value > 0 ? '+' + input.value : input.value;
      state.eq.preset = 'custom';
      eqPreset.value = 'custom';
      applyEqToGraph();
    });
    // change：拖动结束才持久化
    input.addEventListener('change', () => {
      persistSetting({ eq: state.eq });
    });
  });
}

function syncEqUI() {
  const eq = state.eq || defaultEq();
  (eq.bands || EQ_PRESETS.flat.slice()).forEach((g, i) => {
    const input = document.querySelector(`#eq-bands input[data-i="${i}"]`);
    if (input) input.value = g;
    const label = document.getElementById('eq-gain-' + i);
    if (label) label.textContent = g > 0 ? '+' + g : g;
  });
  syncPresetSelectValue();
  [
    ['bass', eqChips.bass],
    ['treble', eqChips.treble],
    ['vocal', eqChips.vocal],
    ['vocal_cancel', eqChips.vocal_cancel]
  ].forEach(([k, el]) => {
    if (el) el.classList.toggle('on', !!eq[k]);
  });

  // 人声消除强度滑块
  const vcAmountEl = $('eq-vocal-cancel-amount');
  const vcLabel = $('eq-vocal-cancel-amount-label');
  const vcPanel = $('eq-vocal-cancel-panel');
  const amount = (eq.vocal_cancel_amount != null) ? eq.vocal_cancel_amount : 100;
  if (vcAmountEl) vcAmountEl.value = amount;
  if (vcLabel) vcLabel.textContent = amount + '%';
  if (vcPanel) vcPanel.classList.toggle('on', !!eq.vocal_cancel);

  updateVocalCancelHint();
}

eqPreset.addEventListener('change', () => {
  const key = eqPreset.value;
  if (key.startsWith('user:')) {
    applyCustomPresetByName(key.slice(5));
    return;
  }
  state.eq.preset = key;
  if (EQ_PRESETS[key]) state.eq.bands = EQ_PRESETS[key].slice();
  syncEqUI();
  applyEqToGraph();
  persistSetting({ eq: state.eq });
});
Object.entries(eqChips).forEach(([k, el]) => {
  if (el) {
    el.addEventListener('click', () => {
      state.eq[k] = !state.eq[k];
      syncEqUI();
      applyEqToGraph();
      persistSetting({ eq: state.eq });
    });
  }
});

// 人声消除强度滑块：input 实时应用（不动磁盘），change 时持久化
(function bindVocalCancelAmount() {
  const el = $('eq-vocal-cancel-amount');
  if (!el) return;
  el.addEventListener('input', () => {
    if (!state.eq) state.eq = defaultEq();
    const v = Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
    state.eq.vocal_cancel_amount = v;
    const label = $('eq-vocal-cancel-amount-label');
    if (label) label.textContent = v + '%';
    if (state.eq.vocal_cancel) applyEqToGraph();
  });
  el.addEventListener('change', () => {
    if (!state.eq) return;
    persistSetting({ eq: state.eq });
  });
})();

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
  if (state.vocalCancel && state.vocalCancel._monoTimer) {
    clearInterval(state.vocalCancel._monoTimer);
    state.vocalCancel._monoTimer = null;
  }
});

// ---------- 频谱分箱 ----------
function spectrumBins(data, count, loHz = 60, hiHz = 7000, fftSize = 2048, sampleRate = 44100) {
  const bins = new Float32Array(count);
  const n = data.length;
  if (!n) return bins;
  const lo = Math.max(1, Math.floor(loHz * fftSize / sampleRate));
  const hi = Math.max(lo + 1, Math.min(n, Math.floor(hiHz * fftSize / sampleRate)));
  const edges = new Array(count + 1);
  for (let i = 0; i <= count; i++) edges[i] = Math.round(lo * Math.pow(hi / lo, i / count));
  for (let i = 0; i < count; i++) {
    const s = edges[i], e = Math.max(s + 1, edges[i + 1]);
    let mx = 0;
    for (let j = s; j < e && j < n; j++) if (data[j] > mx) mx = data[j];
    bins[i] = mx / 255;
  }
  return bins;
}

// 迷你频谱
const miniSmooth = new Float32Array(28);
// 复用同一份频谱缓冲，避免每帧分配 Uint8Array（大小 = analyser.frequencyBinCount）
let _spectrumData = new Uint8Array(1024);

// ---------- 标题栏光带节奏 ----------
// 从同一份频谱取低频段（20~200Hz）平均能量，做 attack/release 平滑后写入 CSS 变量。
// attack 快（0.55）→ 打点立刻冲上去；release 慢（0.12）→ 松开时柔和回落，避免抖动。
const _reduceMotion = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;
let _beatSmoothed = 0;

function _updateTitleBarBeat(data, idle) {
  // 尊重系统"减少动态效果"偏好：直接归零
  if (_reduceMotion) {
    if (_beatSmoothed !== 0) {
      _beatSmoothed = 0;
      document.documentElement.style.setProperty('--title-bar-beat', '0');
    }
    return;
  }

  let target = 0;
  if (!idle && data && data.length) {
    // 频率 = bin * sampleRate / fftSize。fftSize=2048、44.1kHz 时：
    //   20Hz  ≈ bin 1，200Hz ≈ bin 9
    const n = data.length;
    const lo = Math.max(1, Math.floor(20 * 2048 / 44100));
    const hi = Math.min(n, Math.floor(200 * 2048 / 44100));
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += data[i];
    const avg = sum / (hi - lo) / 255;   // 0~1
    // 归一化：真实低频峰值通常在 0.3~0.7，乘 1.6 拉到 0~1 区间
    target = Math.min(1, avg * 1);
  }

  const k = target > _beatSmoothed ? 0.55 : 0.12;
  _beatSmoothed += (target - _beatSmoothed) * k;

  // 归零阈值，避免残值无限拖尾
  if (_beatSmoothed < 0.004) _beatSmoothed = 0;
  document.documentElement.style.setProperty('--title-bar-beat', _beatSmoothed.toFixed(3));
}

function drawMiniSpectrum() {
  const canvas = miniSpectrum;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 空闲判定：无分析器 / 播放器暂停 / 已结束 / 未加载媒体
  const idle = (!state.analyser) || audioPlayer.paused || audioPlayer.ended || !audioPlayer.src;

  let bins = new Float32Array(28);
  let data = null;
  if (!idle && state.analyser) {
    const need = state.analyser.frequencyBinCount;
    if (_spectrumData.length !== need) _spectrumData = new Uint8Array(need);
    state.analyser.getByteFrequencyData(_spectrumData);
    data = _spectrumData;
    bins = spectrumBins(data, 28);
  }
  for (let i = 0; i < 28; i++) miniSmooth[i] = 0.45 * bins[i] + 0.55 * miniSmooth[i];

  // 标题栏光带节奏：复用同一份 data，零额外 FFT / 零额外内存
  _updateTitleBarBeat(data, idle);

  const n = 28, gap = 1;
  const barW = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = miniSmooth[i];
    const bh = Math.max(2, v * (h - 3));
    const x = i * (barW + gap), y = h - 1.5 - bh;
    ctx.fillStyle = getVizColor(v);
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh, barW / 3);
    ctx.fill();
  }

  // 空闲时降到 ~5fps，播放时维持 60fps
  if (idle) {
    setTimeout(drawMiniSpectrum, 200);
  } else {
    requestAnimationFrame(drawMiniSpectrum);
  }
}
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  };
}

// ---------- 可视化 ----------
const vizState = {
  bars: new Float32Array(45),
  ring: new Float32Array(40),
  waterfall: [],
};
const VIZ_BINS = 45, VIZ_RING = 40, VIZ_ROWS = 60;

function openViz() {
  document.body.classList.add('viz-mode');
  vizOverlay.classList.add('show');
  state.vizOpen = true;
  vizState.waterfall = [];
  for (let i = 0; i < VIZ_ROWS; i++) vizState.waterfall.push(new Float32Array(VIZ_BINS));
  if (vizPlaylistPanel) vizPlaylistPanel.classList.remove('show', 'closing');
  syncVizUI();
  updateVizCover();
  resizeVizCanvases();
  if (!state.vizRaf) drawViz();
  setStats('可视化播放中');
}
function closeViz() {
  vizOverlay.classList.remove('show');
  document.body.classList.remove('viz-mode');
  state.vizOpen = false;
  if (vizPlaylistPanel) vizPlaylistPanel.classList.remove('show', 'closing');
  if (state.vizRaf) { cancelAnimationFrame(state.vizRaf); state.vizRaf = null; }
}
function updateVizCover() {
  if (!vizCover) return;
  if (state.currentCoverUrl) {
    vizCover.style.backgroundImage = `url('${state.currentCoverUrl}')`;
    vizCover.style.display = 'block';
  } else {
    vizCover.style.display = 'none';
  }
}
function syncVizUI() {
  vizTitle.textContent = nowPlayingText.textContent;
  vizVolumeSlider.value = volumeSlider.value;
  if (vizPlaymodeSelect) vizPlaymodeSelect.value = playmodeSelect.value;
  vizBtnPlay.innerHTML = IC(state.playing && !state.paused ? 'pause' : 'play');
}

// 悬浮歌单：打开动画 + 关闭动画
function closeVizPlaylistPanel() {
  if (!vizPlaylistPanel || !vizPlaylistPanel.classList.contains('show')) return;
  vizPlaylistPanel.classList.remove('closing');
  void vizPlaylistPanel.offsetWidth;
  vizPlaylistPanel.classList.add('closing');
  setTimeout(() => {
    vizPlaylistPanel.classList.remove('closing', 'show');
  }, 180);
}

function renderVizPlaylist() {
  if (!vizPlaylistList) return;
  if (vizPlaylistCount) vizPlaylistCount.textContent = state.playlist.length;
  if (!state.playlist.length) {
    vizPlaylistList.innerHTML = '<div class="vpl-empty">列表为空</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  state.playlist.forEach((song, idx) => {
    const item = document.createElement('div');
    item.className = 'vpl-item' + (idx === state.currentIndex ? ' playing' : '');
    item.dataset.idx = idx;
    item.innerHTML = `<span class="vpl-idx">${idx + 1}.</span><span class="vpl-info">${escapeHtml(song.singers || '未知歌手')} - ${escapeHtml(song.song_name || '未知歌曲')}</span>`;
    item.addEventListener('click', () => {
      if (state.currentIndex === idx && state.playing && !state.paused) {
        closeVizPlaylistPanel();
        return;
      }
      state.currentIndex = idx;
      playCurrent();
      closeVizPlaylistPanel();
    });
    frag.appendChild(item);
  });
  vizPlaylistList.innerHTML = '';
  vizPlaylistList.appendChild(frag);
}

vizCloseBtn.addEventListener('click', closeViz);
vizMinBtn.addEventListener('click', () => { if (win) win.minimize(); });
vizMaxBtn.addEventListener('click', toggleWindowMaximize);
btnEq.addEventListener('click', openEqModal);
// 封面 → 打开全屏歌词覆盖层
playerCover.addEventListener('click', openFullLyrics);
// 可视化仅通过可视化按钮或快捷键 V 打开
btnViz.addEventListener('click', openViz);

function resizeVizCanvases() {
  ['viz-bars-canvas', 'viz-ring-canvas', 'viz-waterfall-canvas'].forEach(id => {
    const c = $(id);
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(10, Math.round(r.width * dpr));
    c.height = Math.max(10, Math.round(r.height * dpr));
  });
}
window.addEventListener('resize', () => { if (state.vizOpen) resizeVizCanvases(); });

vizBtnPlay.addEventListener('click', () => { togglePlay(); syncVizUI(); });
vizBtnStop.addEventListener('click', () => { stopPlayback(); syncVizUI(); });
vizBtnPrev.addEventListener('click', () => { playPrev(); syncVizUI(); });
vizBtnNext.addEventListener('click', () => { playNext(); syncVizUI(); });
vizPlaymodeSelect.addEventListener('change', async () => {
  const v = vizPlaymodeSelect.value;
  playmodeSelect.value = v;
  settingPlaymode.value = v;
  await persistSetting({ play_mode: parseInt(v, 10) });
});
vizBtnPlaylist.addEventListener('click', (e) => {
  e.stopPropagation();
  const willShow = !vizPlaylistPanel.classList.contains('show');
  if (willShow) {
    vizPlaylistPanel.classList.remove('closing');
    renderVizPlaylist();
    vizPlaylistPanel.classList.add('show');
  } else {
    closeVizPlaylistPanel();
  }
});
vizPlaylistClose.addEventListener('click', () => closeVizPlaylistPanel());

// 点击面板外部关闭
document.addEventListener('click', (e) => {
  if (!state.vizOpen || !vizPlaylistPanel) return;
  if (!vizPlaylistPanel.classList.contains('show')) return;
  if (vizPlaylistPanel.contains(e.target)) return;
  if (vizBtnPlaylist.contains(e.target)) return;
  closeVizPlaylistPanel();
});

vizPositionSlider.addEventListener('input', function () {
  state.dragging = true;
  const total = state.currentDuration;
  if (total > 0) labelTimeViz.textContent = `${formatTime(this.value)} / ${formatTime(total)}`;
});
vizPositionSlider.addEventListener('change', function () {
  state.dragging = false;
  applySeek(parseFloat(this.value));
});

let vizFrame = 0;
function drawViz() {
  if (!state.vizOpen) { state.vizRaf = null; return; }
  const data = new Uint8Array(state.analyser ? state.analyser.frequencyBinCount : 0);
  if (state.analyser) state.analyser.getByteFrequencyData(data);
  const bars = spectrumBins(data, VIZ_BINS, 20, 10000);
  for (let i = 0; i < VIZ_BINS; i++) vizState.bars[i] = 0.4 * bars[i] + 0.6 * vizState.bars[i];
  for (let i = 0; i < VIZ_RING; i++) {
    const src = Math.floor(i / VIZ_RING * VIZ_BINS);
    vizState.ring[i] = 0.4 * vizState.bars[src] + 0.6 * vizState.ring[i];
  }
  drawVizBars();
  drawVizRing();
  vizFrame++;
  if (vizFrame % 2 === 0) {
    vizState.waterfall.pop();
    vizState.waterfall.unshift(Float32Array.from(vizState.bars));
    drawVizWaterfall();
  }
  state.vizRaf = requestAnimationFrame(drawViz);
}
function drawVizBars() {
  const canvas = vizBarsCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const n = VIZ_BINS, gap = 2;
  const barW = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = vizState.bars[i];
    const bh = Math.max(2, v * (h - 4));
    const x = i * (barW + gap), y = h - 2 - bh;
    ctx.fillStyle = getVizColor(v);
    ctx.fillRect(x, y, barW, bh);
  }
}
function drawVizRing() {
  const canvas = vizRingCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 8;
  const n = VIZ_RING;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const v = vizState.ring[i];
    const r = maxR * (0.15 + 0.85 * v);
    const color = getVizColor(v);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, maxR * 0.028);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 2, cy + Math.sin(angle) * 2);
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2 + v * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawVizWaterfall() {
  const canvas = vizWaterfallCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (w <= 2 || h <= 2) return;
  const rows = vizState.waterfall;
  const n = VIZ_BINS;
  const GAP = 1;
  const unit = w / (n * (GAP + 1) - 1);
  const colW = unit;
  const rowH = h / VIZ_ROWS;
  const baseColor = vizPalette.length >= 3 ? vizPalette[2] : '#38BDF8';
  ctx.fillStyle = baseColor;
  for (let r = 0; r < VIZ_ROWS; r++) {
    const row = rows[r];
    const y = r * rowH;
    for (let c = 0; c < n; c++) {
      const v = row[c];
      if (v * v > 0.3) {
        ctx.fillRect(c * unit * (GAP + 1), y, colW + 0.5, rowH + 0.5);
      }
    }
  }
}