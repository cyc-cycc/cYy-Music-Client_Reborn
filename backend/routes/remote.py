# -*- coding: utf-8 -*-
"""手机遥控器：静态页 + 遥控 WS + 播放状态上报 + token 管理。

数据流：
  主窗口 ──POST /player_state──▶ 后端 latest_player_state
                                  │
                                  ├─▶ broadcast_remote() → 所有 /ws/remote 连接
  主窗口 WS /ws ◀── remote_action ┤
  手机端 WS /ws/remote ── action ─┘
"""
import json
import os
import socket
import time

import io

import qrcode
import qrcode.image.svg

from fastapi.responses import HTMLResponse, Response
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from backend import auth, state
from backend.broadcast import broadcast, broadcast_remote
from backend.middleware import extract_token, is_local_request
from utils import logger

router = APIRouter()

WS_CLOSE_NOT_ENABLED = 4403
WS_CLOSE_UNAUTHORIZED = 4401

# WS 消息大小上限：遥控端仅发送简短动作指令，16KB 足够
_MAX_WS_MSG_BYTES = 16 * 1024


# ==================== 手机端页面（内联，零打包依赖） ====================
_REMOTE_HTML = """<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0D1117" id="meta-theme-color">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<title>cYy Music · 遥控</title>
<style>
  :root {
    --primary: #58A6FF;
    --bg: #0D1117;
    --surface: #161B22;
    --surface-2: #21262D;
    --border: #30363D;
    --text: #F0F6FC;
    --text-2: #8B949E;
    --text-3: #484F58;
    --danger: #F85149;
    --radius: 12px;
    --radius-lg: 16px;
    --gap: clamp(8px, 1.8vh, 16px);
  }
  html[data-theme="light"] {
    --bg: #F5F7FA;
    --surface: #FFFFFF;
    --surface-2: #F0F1F3;
    --border: #E5E7EB;
    --text: #1A2B4C;
    --text-2: #6B7280;
    --text-3: #9CA3AF;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }
  html, body {
    height: 100%;
    height: 100dvh;
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: manipulation;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    transition: background 0.3s ease, color 0.3s ease;
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: flex;
    flex-direction: column;
    padding:
      max(env(safe-area-inset-top), var(--gap))
      max(env(safe-area-inset-right), var(--gap))
      max(env(safe-area-inset-bottom), var(--gap))
      max(env(safe-area-inset-left), var(--gap));
    gap: var(--gap);
    max-width: 560px;
    margin: 0 auto;
    width: 100%;
  }
  @media (min-width: 640px) {
    body { max-width: 560px; }
  }
  /* 横屏：封面左置 + 内容右置 */
  @media (max-height: 500px) and (orientation: landscape) {
    body {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 16px;
      row-gap: 4px;
      align-items: center;
      max-width: none;
      padding:
        max(env(safe-area-inset-top), 8px)
        max(env(safe-area-inset-right), 12px)
        max(env(safe-area-inset-bottom), 8px)
        max(env(safe-area-inset-left), 12px);
    }
    #cover {
      grid-column: 1;
      grid-row: 1 / -1;
      width: min(28vh, 96px);
      height: min(28vh, 96px);
      font-size: clamp(28px, 6vh, 44px);
      align-self: center;
    }
    #info, #lyric, #progress-row, #controls, #bottom-row, #status {
      grid-column: 2;
      min-width: 0;
    }
    #lyric { min-height: auto; }
    #controls { justify-content: flex-start; gap: 14px; }
    #status { text-align: left; padding: 0; }
  }
  #cover {
    width: min(68vw, 36vh, 340px);
    height: min(68vw, 36vh, 340px);
    aspect-ratio: 1 / 1;
    align-self: center;
    border-radius: var(--radius-lg);
    background-color: var(--surface);
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(48px, 15vw, 96px);
    color: var(--text-3);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    transition: background-color 0.3s ease, box-shadow 0.3s ease;
    flex-shrink: 0;
  }
  #info { text-align: center; }
  #title {
    font-size: clamp(16px, 4.4vw, 22px);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.35;
  }
  #singer {
    font-size: clamp(12px, 3.2vw, 14px);
    color: var(--text-2);
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #lyric {
    min-height: 48px;
    text-align: center;
    font-size: clamp(12px, 3.4vw, 15px);
    line-height: 1.7;
    color: var(--text-2);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    transition: color 0.3s ease;
  }
  #lyric .cur {
    color: var(--primary);
    font-weight: 600;
    font-size: clamp(14px, 4vw, 17px);
  }
  #progress-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: clamp(11px, 3vw, 13px);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  #progress-row > span { min-width: 40px; text-align: center; }
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    height: 32px;
    flex: 1;
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-runnable-track {
    height: 6px;
    background: var(--border);
    border-radius: 3px;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--primary);
    margin-top: -7px;
    box-shadow: 0 0 10px color-mix(in srgb, var(--primary) 50%, transparent);
    transition: transform 0.15s ease;
  }
  input[type="range"]:active::-webkit-slider-thumb { transform: scale(1.2); }
  input[type="range"]::-moz-range-track {
    height: 6px;
    background: var(--border);
    border-radius: 3px;
  }
  input[type="range"]::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--primary);
    border: none;
  }
  #controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: clamp(8px, 3vw, 18px);
  }
  .btn {
    border: none;
    background: var(--surface);
    color: var(--text);
    width: clamp(46px, 13vw, 54px);
    height: clamp(46px, 13vw, 54px);
    min-width: 44px;
    min-height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s ease, background 0.2s ease, color 0.2s ease;
    flex-shrink: 0;
    padding: 0;
    font-weight: 700;
  }
  .btn:active { transform: scale(0.9); }
  .btn.primary {
    background: var(--primary);
    color: #fff;
    width: clamp(58px, 17vw, 68px);
    height: clamp(58px, 17vw, 68px);
    min-width: 56px;
    min-height: 56px;
    box-shadow: 0 4px 20px color-mix(in srgb, var(--primary) 40%, transparent);
  }
  .btn svg { width: clamp(20px, 6vw, 26px); height: clamp(20px, 6vw, 26px); display: block; }
  .btn.primary svg { width: clamp(26px, 8vw, 32px); height: clamp(26px, 8vw, 32px); }
  .btn.small {
    width: clamp(42px, 12vw, 48px);
    height: clamp(42px, 12vw, 48px);
    font-size: clamp(11px, 3.1vw, 13px);
    font-weight: 700;
    color: var(--text-2);
    letter-spacing: -0.5px;
  }
  .btn.small:active { color: var(--primary); }
  #bottom-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #volume-row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: clamp(11px, 3vw, 12px);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  #volume-row > svg { flex-shrink: 0; color: var(--text-2); }
  #vol-label { min-width: 32px; text-align: right; }
  .icon-btn {
    background: var(--surface);
    color: var(--text);
    border: none;
    height: 34px;
    min-width: 46px;
    padding: 0 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
    transition: transform 0.15s ease, background 0.2s ease, color 0.2s ease;
    font-family: inherit;
  }
  .icon-btn:active { transform: scale(0.94); }
  #b-mode { letter-spacing: 0.5px; }
  #b-playlist { width: 38px; min-width: 38px; padding: 0; }
  #status {
    text-align: center;
    font-size: 11px;
    color: var(--text-3);
    padding: 2px;
    letter-spacing: 0.2px;
    transition: color 0.2s ease;
    min-height: 14px;
  }
  #status.err { color: var(--danger); }

  /* ---------- 播放列表抽屉 ---------- */
  #pl-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
    z-index: 100;
  }
  #pl-overlay.show { opacity: 1; pointer-events: auto; }
  #pl-drawer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 72vh;
    background: var(--surface);
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 101;
    display: flex;
    flex-direction: column;
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35);
    padding-bottom: env(safe-area-inset-bottom);
  }
  #pl-drawer.show { transform: translateY(0); }
  .pd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    font-size: 14px;
    color: var(--text);
    font-weight: 600;
  }
  .pd-header b { color: var(--text-2); font-weight: 500; }
  .pd-close {
    background: none;
    border: none;
    color: var(--text-2);
    font-size: 22px;
    cursor: pointer;
    padding: 0 6px;
    line-height: 1;
    transition: color 0.15s ease;
  }
  .pd-close:active { color: var(--danger); }
  #pl-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
    -webkit-overflow-scrolling: touch;
  }
  .pl-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 18px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .pl-item:active { background: var(--surface-2); }
  .pl-item.current {
    color: var(--primary);
    font-weight: 600;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
  }
  .pl-item .pi-idx {
    width: 26px;
    text-align: right;
    color: var(--text-3);
    font-size: 12px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .pl-item.current .pi-idx { color: var(--primary); }
  .pl-item .pi-info {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pl-empty {
    padding: 48px 20px;
    text-align: center;
    color: var(--text-3);
    font-size: 13px;
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body>
  <div id="cover">♪</div>
  <div id="info">
    <div id="title">等待连接…</div>
    <div id="singer">—</div>
  </div>
  <div id="lyric"></div>
  <div id="progress-row">
    <span id="t-cur">00:00</span>
    <input type="range" id="seek" min="0" max="0" step="0.1" value="0" aria-label="播放进度">
    <span id="t-total">00:00</span>
  </div>
  <div id="controls">
    <button class="btn small" id="b-rew" aria-label="后退 15 秒" title="-15s">-15</button>
    <button class="btn" id="b-prev" aria-label="上一首"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 20 9 12l10-8v16zM5 19V5h3v14z"/></svg></button>
    <button class="btn primary" id="b-toggle" aria-label="播放/暂停"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 13 8-13 8V4z"/></svg></button>
    <button class="btn" id="b-next" aria-label="下一首"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m5 4 10 8-10 8V4zM16 5h3v14h-3z"/></svg></button>
    <button class="btn small" id="b-ff" aria-label="前进 15 秒" title="+15s">+15</button>
  </div>
  <div id="bottom-row">
    <div id="volume-row">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
      <input type="range" id="vol" min="0" max="100" value="60" aria-label="音量">
      <span id="vol-label">60%</span>
    </div>
    <button class="icon-btn" id="b-mode" title="播放模式">列循</button>
    <button class="icon-btn" id="b-playlist" title="播放列表">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M8 6h13M8 12h13M8 18h13"/>
        <path d="M3 6h.01M3 12h.01M3 18h.01"/>
      </svg>
    </button>
  </div>
  <div id="status">正在连接…</div>

  <div id="pl-overlay"></div>
  <div id="pl-drawer" role="dialog" aria-label="播放列表">
    <div class="pd-header">
      <span>播放列表 · <b id="pl-count">0</b></span>
      <button class="pd-close" id="pl-close" aria-label="关闭">×</button>
    </div>
    <div id="pl-list"></div>
  </div>

<script>
(function() {
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsProto + '//' + location.host + '/ws/remote?t=' + encodeURIComponent(token);

  const $ = (id) => document.getElementById(id);
  const metaThemeColor = $('meta-theme-color');
  const state = {
    playing: false, paused: false, position: 0, duration: 0,
    volume: 60, lyricCurrent: '', lyricNext: '',
    theme: 'dark', primary: '#58A6FF',
    playlist: [], currentIndex: -1, playMode: 2,
  };
  let ws = null;
  let seeking = false;
  let retry = 0;

  const MODE_LABELS = ['单循', '单停', '列循', '列停'];

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ---- 主题同步 ----
  function applyTheme() {
    const t = state.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    if (state.primary) {
      document.documentElement.style.setProperty('--primary', state.primary);
    }
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', t === 'light' ? '#F5F7FA' : '#0D1117');
    }
  }

  // ---- 播放模式按钮 ----
  function updateModeButton() {
    const m = (typeof state.playMode === 'number') ? state.playMode : 2;
    const btn = $('b-mode');
    if (btn) btn.textContent = MODE_LABELS[m] || '列循';
  }

  function cycleMode() {
    const cur = (typeof state.playMode === 'number') ? state.playMode : 2;
    const next = (cur + 1) % 4;
    state.playMode = next;
    updateModeButton();
    send({ type: 'set-mode', value: next });
  }

  // ---- 播放列表抽屉 ----
  function renderPlaylist() {
    const list = state.playlist || [];
    const cur = (typeof state.currentIndex === 'number') ? state.currentIndex : -1;
    const countEl = $('pl-count');
    const listEl = $('pl-list');
    if (countEl) countEl.textContent = list.length;
    if (!listEl) return;
    if (!list.length) {
      listEl.innerHTML = '<div class="pl-empty">播放列表为空</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      const name = esc(s.name || '未知歌曲');
      const singer = esc(s.singer || '');
      html += '<div class="pl-item' + (i === cur ? ' current' : '') + '" data-idx="' + i + '">'
           + '<span class="pi-idx">' + (i + 1) + '</span>'
           + '<span class="pi-info">' + (singer ? singer + ' - ' : '') + name + '</span>'
           + '</div>';
    }
    listEl.innerHTML = html;
  }

  function openPlaylist() {
    renderPlaylist();
    $('pl-drawer').classList.add('show');
    $('pl-overlay').classList.add('show');
  }
  function closePlaylist() {
    $('pl-drawer').classList.remove('show');
    $('pl-overlay').classList.remove('show');
  }

  function render() {
    applyTheme();
    $('title').textContent = state.song_name || '未播放';
    $('singer').textContent = state.singers || '—';
    $('b-toggle').innerHTML = (state.playing && !state.paused)
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 13 8-13 8V4z"/></svg>';
    const coverEl = $('cover');
    if (state.cover) {
      coverEl.style.backgroundImage = 'url("' + String(state.cover).replace(/"/g, '%22') + '")';
      coverEl.textContent = '';
    } else {
      coverEl.style.backgroundImage = '';
      coverEl.textContent = '♪';
    }
    if (!seeking) {
      $('seek').max = state.duration || 0;
      $('seek').value = Math.min(state.position || 0, state.duration || 0);
    }
    $('t-cur').textContent = fmt(state.position);
    $('t-total').textContent = state.duration ? fmt(state.duration) : '--:--';
    if (typeof state.volume === 'number' && document.activeElement !== $('vol')) {
      $('vol').value = state.volume;
      $('vol-label').textContent = state.volume + '%';
    }
    // 歌词（遥控端仅需当前行 + 下一行，由主窗口精简后推送）
    const cur = state.lyricCurrent || '';
    const nxt = state.lyricNext || '';
    if (cur || nxt) {
      $('lyric').innerHTML =
        (cur ? '<div class="cur">' + esc(cur) + '</div>' : '') +
        (nxt ? '<div>' + esc(nxt) + '</div>' : '');
    } else {
      $('lyric').innerHTML = '';
    }
    updateModeButton();
    // 抽屉打开时刷新列表
    if ($('pl-drawer').classList.contains('show')) renderPlaylist();
  }

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      retry = 0;
      $('status').className = '';
      $('status').textContent = '已连接';
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'player_state') {
          Object.assign(state, data);
          render();
        } else if (data.type === 'kicked') {
          $('status').className = 'err';
          $('status').textContent = '已断开，请扫描新二维码';
          try { ws.close(); } catch (e) {}
        }
      } catch (e) {}
    };
    ws.onclose = (ev) => {
      if (ev.code === 4401) {
        $('status').className = 'err';
        $('status').textContent = 'token 无效或已过期';
        return;
      }
      if (ev.code === 4403) {
        $('status').className = 'err';
        $('status').textContent = '遥控未启用';
        return;
      }
      retry++;
      $('status').className = 'err';
      $('status').textContent = '连接断开，' + Math.min(30, retry * 2) + 's 后重试…';
      setTimeout(connect, Math.min(30000, retry * 2000));
    };
    ws.onerror = () => {
      $('status').className = 'err';
      $('status').textContent = '连接失败';
    };
  }

  function send(action) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: action }));
  }

  $('b-prev').addEventListener('click', () => send({ type: 'prev' }));
  $('b-next').addEventListener('click', () => send({ type: 'next' }));
  $('b-toggle').addEventListener('click', () => send({ type: 'toggle' }));
  $('b-rew').addEventListener('click', () => send({ type: 'seek-relative', value: -15 }));
  $('b-ff').addEventListener('click', () => send({ type: 'seek-relative', value: 15 }));
  $('b-mode').addEventListener('click', cycleMode);
  $('b-playlist').addEventListener('click', openPlaylist);
  $('pl-close').addEventListener('click', closePlaylist);
  $('pl-overlay').addEventListener('click', closePlaylist);

  $('pl-list').addEventListener('click', (e) => {
    const item = e.target.closest('.pl-item');
    if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    send({ type: 'play-index', value: idx });
    closePlaylist();
  });

  $('seek').addEventListener('pointerdown', () => { seeking = true; });
  $('seek').addEventListener('input', function () {
    $('t-cur').textContent = fmt(parseFloat(this.value) || 0);
  });
  $('seek').addEventListener('change', function () {
    seeking = false;
    send({ type: 'seek', value: parseFloat(this.value) || 0 });
  });

  $('vol').addEventListener('input', function () {
    const v = parseInt(this.value, 10) || 0;
    $('vol-label').textContent = v + '%';
  });
  $('vol').addEventListener('change', function () {
    send({ type: 'set-volume', value: parseInt(this.value, 10) || 0 });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });

  // 移动端：阻止双击缩放
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  applyTheme();
  updateModeButton();
  connect();
})();
</script>
</body>
</html>
"""


# ==================== 静态页 ====================
@router.get("/remote")
def remote_page():
    return HTMLResponse(content=_REMOTE_HTML)


# ==================== token 管理 ====================
_lan_ip_cache = {'value': None, 'ts': 0.0}
_LAN_IP_TTL = 30.0


def _lan_ip() -> str:
    ip = os.environ.get('CMC_LAN_IP', '').strip()
    if ip:
        return ip
    now = time.time()
    if _lan_ip_cache['value'] is not None and now - _lan_ip_cache['ts'] < _LAN_IP_TTL:
        return _lan_ip_cache['value']
    try:
        # 兜底：通过连接外部地址探测本机网卡出口 IP（不实际发包）
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = ''
    _lan_ip_cache['value'] = ip
    _lan_ip_cache['ts'] = now
    return ip


def _build_status() -> dict:
    enabled = bool(state.settings.get('remote_enabled', False))
    token = state.settings.get('remote_token', '') or ''
    # 双保险：若内存里缺这个 token（例如进程重启、或 settings 被直接改写），
    # 在此刻补注册，保证「页面上显示的链接」一定能用。
    if enabled and token:
        try:
            auth.ensure_token(token)
        except Exception:
            pass
    lan_ip = _lan_ip()
    try:
        port = int(os.environ.get('CMC_API_PORT', 8000))
    except Exception:
        port = 8000
    url = ''
    ws_url = ''
    if enabled and token and lan_ip:
        url = f'http://{lan_ip}:{port}/remote?t={token}'
        ws_url = f'ws://{lan_ip}:{port}/ws/remote?t={token}'
    with state.remote_ws_lock:
        connected = len(state.remote_websockets)
    return {
        'enabled': enabled,
        'lan_ip': lan_ip,
        'port': port,
        'token': token,
        'url': url,
        'ws_url': ws_url,
        'connected_remotes': connected,
    }


@router.get("/remote/status")
def remote_status():
    return _build_status()


@router.get("/remote/qrcode")
def remote_qrcode():
    """返回当前遥控 URL 的 SVG 二维码。

    - 未启用 / 无局域网 IP 时返回 404
    - 前端用 <img src=".../remote/qrcode?ts=..."> 加载，ts 用于破除缓存
    - 二维码为深色码点 + 透明背景：前端套白色卡片显示，扫码最稳
    """
    s = _build_status()
    if not s.get('url'):
        raise HTTPException(status_code=404, detail='遥控未启用或未获取到局域网地址')
    try:
        factory = qrcode.image.svg.SvgPathImage
        img = qrcode.make(s['url'], image_factory=factory, box_size=8, border=2)
        buf = io.BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode('utf-8')
        return Response(
            content=svg,
            media_type='image/svg+xml',
            headers={'Cache-Control': 'no-store'},
        )
    except Exception as e:
        logger.error(f'二维码生成失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remote/enable")
def remote_enable():
    """启用遥控：生成新 token 并持久化（本地请求，中间件已放行）"""
    from config import save_settings
    token = auth.generate_token()
    state.settings['remote_enabled'] = True
    state.settings['remote_token'] = token
    save_settings(state.settings)
    logger.info('遥控已启用')
    return _build_status()


@router.post("/remote/disable")
def remote_disable():
    """关闭遥控：撤销所有 token，并清空 remote_token"""
    from config import save_settings
    auth.revoke_all()
    state.settings['remote_enabled'] = False
    state.settings['remote_token'] = ''
    save_settings(state.settings)
    # 通知所有遥控端断开
    broadcast_remote({'type': 'kicked'})
    logger.info('遥控已关闭')
    return _build_status()


@router.post("/remote/rotate")
def remote_rotate():
    """重置 token：旧 token 立即失效"""
    from config import save_settings
    auth.revoke_all()
    token = auth.generate_token()
    state.settings['remote_token'] = token
    save_settings(state.settings)
    broadcast_remote({'type': 'kicked'})
    logger.info('遥控 token 已重置')
    return _build_status()


# ==================== 播放状态上报（主窗口 → 后端） ====================
@router.post("/player_state")
def update_player_state(payload: dict):
    with state.player_state_lock:
        state.latest_player_state = payload or {}
    # 广播给所有遥控端
    msg = {'type': 'player_state'}
    msg.update(payload or {})
    broadcast_remote(msg)
    return {'ok': True}


@router.get("/player_state")
def get_player_state():
    with state.player_state_lock:
        return dict(state.latest_player_state)


# ==================== 遥控端 WS ====================
@router.websocket("/ws/remote")
async def remote_ws(websocket: WebSocket):
    if not state.settings.get('remote_enabled', False):
        await websocket.close(code=WS_CLOSE_NOT_ENABLED)
        return
    if not auth.validate_token(extract_token(websocket)):
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return

    await websocket.accept()
    with state.remote_ws_lock:
        state.remote_websockets.append(websocket)
    logger.info(f'遥控端已连接，当前在线 {len(state.remote_websockets)}')

    # 初次连接推送当前状态
    try:
        with state.player_state_lock:
            snapshot = dict(state.latest_player_state)
        if snapshot:
            msg = {'type': 'player_state'}
            msg.update(snapshot)
            await websocket.send_text(json.dumps(msg, ensure_ascii=False))
    except Exception:
        pass

    try:
        while True:
            data = await websocket.receive_text()
            if len(data) > _MAX_WS_MSG_BYTES:
                logger.warning(f'遥控 WS 收到超大消息（{len(data)}B），丢弃')
                continue
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue
            action = msg.get('action')
            if not action or not action.get('type'):
                continue
            # 转发到主窗口（渲染进程通过 /ws 接收）
            broadcast({'type': 'remote_action', 'action': action})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f'遥控 WS 异常: {e}')
    finally:
        with state.remote_ws_lock:
            if websocket in state.remote_websockets:
                state.remote_websockets.remove(websocket)
        logger.info(f'遥控端已断开，当前在线 {len(state.remote_websockets)}')