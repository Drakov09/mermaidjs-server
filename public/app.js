/* global mermaid */
const codeEl = document.getElementById('code');
const themeEl = document.getElementById('theme');
const bgEl = document.getElementById('background');
const wEl = document.getElementById('width');
const hEl = document.getElementById('height');
const localBtn = document.getElementById('renderLocal');
const serverBtn = document.getElementById('renderServer');
const clientRender = document.getElementById('clientRender');
const serverRender = document.getElementById('serverRender');
const serverInfo = document.getElementById('serverInfo');
const wsStatus = document.getElementById('wsStatus');
const validationMsg = document.getElementById('validationMsg');

let ws;
let reconnectTimer;

// ===== 实时渲染控制参数 =====
const INPUT_DEBOUNCE_MS = 600;      // 输入停止后本地/服务端流程触发
const SERVER_THROTTLE_MS = 1000;    // 与服务器通信最小间隔
const INACTIVITY_CLOSE_MS = 60000;   // 无请求后自动关闭 WS
let lastServerSendTs = 0;
let pendingServerPayload = null;
let throttleTimer = null;
let lastCodeSent = '';
let lastValidatedCode = '';
let inactivityCloseTimer = null;
let autoClosedIdle = false;

function connectWs(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Derive context root: remove /demo or /demo/... suffix so WS path is always <context>/ws
  // Examples:
  //  /demo -> ''
  //  /demo/index.html -> ''
  //  /api/mermaid/demo -> /api/mermaid
  //  /api/mermaid/demo/index.html -> /api/mermaid
  const pathname = location.pathname.replace(/\/index\.html$/i,'');
  const contextRoot = pathname.replace(/\/demo(?:\/.*)?$/i, '');
  const base = contextRoot === '' ? '' : contextRoot; // '' or '/something'
  const url = proto + '//' + location.host + base + '/ws';
  ws = new WebSocket(url);
  wsStatus.textContent = 'CONNECTING';
  const ts = () => new Date().toISOString();
  ws.addEventListener('open', ()=>{ 
    wsStatus.textContent='CONNECTED'; wsStatus.style.color='#16a34a'; 
    autoClosedIdle = false;
    console.info(`[WS][${ts()}] OPEN url=${url}`);
    // 若存在待发送 payload，立即发送
    if (pendingServerPayload){
      try { ws.send(JSON.stringify(pendingServerPayload)); lastServerSendTs = Date.now(); lastCodeSent = pendingServerPayload.mermaid; restartInactivityTimer(); } catch(e){}
      pendingServerPayload = null;
    }
  });
  ws.addEventListener('close', (e)=>{ 
    wsStatus.textContent = autoClosedIdle ? 'IDLE-CLOSED' : 'DISCONNECTED'; 
    wsStatus.style.color = autoClosedIdle ? '#64748b' : '#dc2626';
    console.warn(`[WS][${ts()}] CLOSE code=${e.code} reason=${e.reason||'(none)'} clean=${e.wasClean} idleAuto=${autoClosedIdle}`);
    // 不再无限重连；由用户输入触发 ensureWsConnected
  });
  ws.addEventListener('error', (e)=>{ wsStatus.textContent='ERROR'; wsStatus.style.color='#dc2626'; console.error(`[WS][${ts()}] ERROR`, e); });
  ws.addEventListener('message', (evt)=>{
    try {
      const msg = JSON.parse(evt.data);
      if(msg.type==='render-result'){
        updateServerResult(msg);
      }
    } catch(e){ console.error('WS message parse error', e); }
  });
}
// 初始不立即连接；首次需要发送时再连接

function ensureWsConnected(){
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return; // connecting or open
  connectWs();
}

function restartInactivityTimer(){
  clearTimeout(inactivityCloseTimer);
  inactivityCloseTimer = setTimeout(()=>{
    if (ws && ws.readyState === 1){
      autoClosedIdle = true;
      ws.close();
    }
  }, INACTIVITY_CLOSE_MS);
}

function updateServerResult(data){
  const { format, cache, timings, pngBase64, error, width, height, cacheKey } = data;
  if(error){
    serverRender.innerHTML = `<div class="mermaid-error">服务器错误: ${error}</div>`;
    return;
  }
  serverInfo.textContent = `格式: ${format}\n缓存: ${cache}\n耗时(ms): total=${timings.total} render=${timings.render} rasterize=${timings.rasterize}\ncacheKey: ${cacheKey}`;
  if(format==='png' && pngBase64){
    serverRender.innerHTML = `<img alt="server png" style="max-width:100%;" src="data:image/png;base64,${pngBase64}" />`;
  } else if(format==='svg' && data.svg){
    serverRender.innerHTML = data.svg; // sanitized assumption (server generates)
  }
}

function formatMermaidError(e, code){
  const raw = (e.str || e.message || String(e));
  let msg = raw.replace(/\s+at .*/g, '').trim();
  const lineMatch = msg.match(/line\s+(\d+)/i);
  const colMatch = msg.match(/column\s+(\d+)/i);
  let detail = '';
  let snippetBlock = '';
  if (lineMatch){
    const lineNum = parseInt(lineMatch[1], 10);
    const lines = code.split(/\r?\n/);
    if (lineNum>=1 && lineNum<=lines.length){
      const snippet = lines[lineNum-1];
      detail = `第 ${lineNum} 行${colMatch?(' 第 '+colMatch[1]+' 列'):''}`;
      // 构造上下文 (前1/后1行)
      const from = Math.max(1, lineNum-1);
      const to = Math.min(lines.length, lineNum+1);
      const width = String(to).length;
      let pointerLine = '';
      if (colMatch){
        const col = parseInt(colMatch[1],10);
        pointerLine = ' '.repeat(width+2) + ' '.repeat(Math.max(0,col-1)) + '^';
      }
      for (let i=from;i<=to;i++){
        const ln = String(i).padStart(width,' ');
        snippetBlock += `${ln}| ${lines[i-1]}\n`;
        if (i===lineNum && pointerLine){
          snippetBlock += pointerLine + '\n';
        }
      }
    }
  }
  if (/Expecting/.test(msg)) {
    msg += ' —— 请检查节点/箭头语法、换行或是否缺少空格';
  }
  const tips = '\n提示: 确认各行是否以关键字(如 graph TD) 开头，节点/边语法 A-->B 是否正确，中文字符后是否需要空格。';
  const snippetText = snippetBlock ? ('\n代码片段:\n'+snippetBlock) : '';
  return detail ? `${msg}\n${detail}${snippetText}${tips}` : msg + tips;
}

function validateMermaid(code){
  try {
    mermaid.parse(code);
    validationMsg.textContent='';
    return true;
  } catch(e){
    validationMsg.textContent = '语法错误:\n' + formatMermaidError(e, code);
    return false;
  }
}

async function renderLocal(code){
  try {
    const res = await mermaid.render('livePreview', code);
    clientRender.innerHTML = res.svg;
    if (typeof res.bindFunctions === 'function') res.bindFunctions(clientRender);
    return true;
  } catch(e){
    clientRender.innerHTML = '<div class="mermaid-error">本地渲染失败: '+ (e.message||e) + '</div>';
    return false;
  }
}

function scheduleServerSend(code){
  // 确保连接（懒连接）
  ensureWsConnected();
  if (!ws || (ws.readyState !== 1 && ws.readyState !== 0)) return; // 若仍未建立/正在建立则等待 open 事件
  if (code === lastCodeSent) return;
  const payload = {
    type: 'render',
    mermaid: code,
    theme: themeEl.value,
    backgroundColor: bgEl.value,
    width: Number(wEl.value)||800,
    height: Number(hEl.value)||600,
    format: 'png'
  };
  const now = Date.now();
  const elapsed = now - lastServerSendTs;
  if (ws.readyState === 0){
    // 连接尚未 open，挂起
    pendingServerPayload = payload;
    return;
  }
  if (elapsed >= SERVER_THROTTLE_MS){
    try { ws.send(JSON.stringify(payload)); } catch(e) { return; }
    lastServerSendTs = now;
    lastCodeSent = code;
    serverInfo.textContent = '已发送到服务器 (实时)';
    restartInactivityTimer();
  } else {
    pendingServerPayload = payload;
    if (!throttleTimer){
      const wait = SERVER_THROTTLE_MS - elapsed;
      throttleTimer = setTimeout(()=>{
        throttleTimer = null;
        if (pendingServerPayload && ws && ws.readyState===1){
          try { ws.send(JSON.stringify(pendingServerPayload)); } catch(e) { return; }
          lastServerSendTs = Date.now();
          lastCodeSent = pendingServerPayload.mermaid;
          serverInfo.textContent = '已发送到服务器 (节流尾)';
          pendingServerPayload = null;
          restartInactivityTimer();
        }
      }, wait);
    }
  }
}

codeEl.addEventListener('input', debounce(async ()=>{
  const code = codeEl.value;
  const ok = validateMermaid(code);
  if (!ok) return; // 语法不通过
  if (code === lastValidatedCode) return; // 未变化
  // 先本地渲染，只有成功才尝试服务端
  const rendered = await renderLocal(code);
  if (!rendered) return;
  lastValidatedCode = code;
  scheduleServerSend(code);
}, INPUT_DEBOUNCE_MS));

localBtn.addEventListener('click', async ()=>{
  const code = codeEl.value;
  if(!validateMermaid(code)) return;
  await renderLocal(code);
});

serverBtn.addEventListener('click', ()=>{
  if(ws?.readyState!==1) return;
  const code = codeEl.value;
  if(!validateMermaid(code)) return;
  // 确保已经成功本地渲染过才发送
  renderLocal(code).then(ok=>{ if(ok) scheduleServerSend(code); });
});

function debounce(fn, wait){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); };
}
