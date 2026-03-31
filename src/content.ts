// Content script for the Chrome Extension
import TurndownService from 'turndown';

let isPicking = false;
let currentTarget: 'listSelector' | 'loadMoreSelector' | 'detailSelector' | 'apiSniffer' | null = null;
let hoveredElement: HTMLElement | null = null;
const turndownService = new TurndownService({ headingStyle: 'atx' });

let isSniffingActive = false;
let sniffedRequests: any[] = [];

// injectNetworkSniffer is now handled by src/main-world.ts via world: MAIN in manifest.json


window.addEventListener('__WEB_SCRAPER_NETWORK_HOOK', (e: Event) => {
  if (!isSniffingActive) return;
  const customEvent = e as CustomEvent;
  const data = customEvent.detail;
  
  const url = (data.url || '').toLowerCase();
  const ignoreWords = ['analytics', 'pixel', 'log', 'tracking', 'css', 'js', 'png', 'jpg'];
  if (ignoreWords.some(w => url.includes(w))) return;

  const requestId = data.requestId;

  // Update or push to sniffedRequests
  const existingIdx = sniffedRequests.findIndex(r => r.requestId === requestId);
  if (existingIdx > -1) {
    if (data.stage === 'complete') {
        sniffedRequests[existingIdx].response = data.response;
    }
  } else {
    sniffedRequests.push(data);
  }

  // Update real-time UI
  const logContainer = document.getElementById('web-scraper-sniff-log');
  if (logContainer) {
    logContainer.style.display = 'block';
    
    const itemId = `sniff-item-${requestId}`;
    let item = document.getElementById(itemId);
    
    if (!item) {
      item = document.createElement('div');
      item.id = itemId;
      item.className = 'web-scraper-sniffer-item';
      item.style.cursor = 'pointer';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '6px';
      item.onmouseover = () => item!.style.background = 'rgba(255,255,255,0.1)';
      item.onmouseout = () => item!.style.background = 'transparent';
      item.onclick = () => showResponsePreview(sniffedRequests.find(r => r.requestId === requestId));
      logContainer.prepend(item);
    }
    
    const statusIcon = data.stage === 'complete' ? '✅' : '⏳';
    const statusColor = data.stage === 'complete' ? '#34d399' : '#fbbf24';
    
    item.innerHTML = `
      <span style="color:${statusColor}; font-size:10px;">${statusIcon}</span>
      <div style="overflow:hidden; text-overflow:ellipsis; flex:1;">
        [${data.type.toUpperCase()}] ${data.method} ${data.url.split('/').pop()?.split('?')[0] || data.url}
      </div>
      ${data.stage === 'complete' ? '<span style="font-size:10px; color:#9ca3af;">🔍</span>' : ''}
    `;
    
    const countEl = document.getElementById('web-scraper-sniff-count');
    if (countEl) countEl.textContent = sniffedRequests.length.toString();
  }
});
// Specialized parser for Samsung Global SSR (pdd32 structure)
const samsungSpecificParser = (root: HTMLElement): string => {
  const specItems = root.querySelectorAll('.pdd32-product-spec__detail-item');
  if (specItems.length === 0) return "";

  let markdown = "\n\n| Attribute | Value |\n| --- | --- |\n";
  specItems.forEach(item => {
    const title = item.querySelector('.pdd32-product-spec__detail-title')?.textContent?.trim() || "";
    const text = item.querySelector('.pdd32-product-spec__detail-text')?.textContent?.trim() || "";
    if (title && text) {
      markdown += `| ${title} | ${text} |\n`;
    }
  });
  return markdown;
};

let activeOverlay: HTMLDivElement | null = null;

// Inject CSS for highlighting and toasts explicitly
const injectStyles = () => {
  if (document.getElementById('web-scraper-styles')) return;
  const style = document.createElement('style');
  style.id = 'web-scraper-styles';
  style.textContent = `
    .web-scraper-highlight {
      outline: 2px solid #ef4444 !important;
      outline-offset: -2px !important;
      background-color: rgba(239, 68, 68, 0.1) !important;
      transition: all 0.1s ease-in-out !important;
      cursor: crosshair !important;
    }
    .web-scraper-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #111827;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      z-index: 9999999;
      font-family: -apple-system, system-ui, sans-serif;
      font-size: 14px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      transition: opacity 0.3s;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .web-scraper-sniffer-log {
      max-height: 120px;
      overflow-y: auto;
      margin-top: 10px;
      background: rgba(0,0,0,0.3);
      border-radius: 4px;
      padding: 6px;
      font-family: 'Menlo', 'Monaco', monospace;
      font-size: 11px;
      display: none;
    }
    .web-scraper-sniffer-item {
      color: #34d399; /* emerald-400 */
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding-bottom: 2px;
    }
    .web-scraper-timer-container {
      height: 6px;
      background: #374151;
      border-radius: 3px;
      margin-top: 10px;
      overflow: hidden;
      display: none;
    }
    .web-scraper-timer-progress {
      height: 100%;
      background: #3b82f6;
      width: 0%;
    }
  `;
  document.head.appendChild(style);
};

let activeToast: HTMLDivElement | null = null;
const showToast = (message: string, autoCloseMs = 0) => {
  injectStyles();
  if (activeToast) {
    activeToast.remove();
  }
  activeToast = document.createElement('div');
  activeToast.className = 'web-scraper-toast';
  activeToast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(activeToast);

  if (autoCloseMs > 0) {
    setTimeout(() => {
      if (activeToast) {
        activeToast.style.opacity = '0';
        setTimeout(() => activeToast?.remove(), 300);
      }
    }, autoCloseMs);
  }
};

const showResponsePreview = (requestData: any) => {
  if (document.getElementById('web-scraper-response-modal')) {
    document.getElementById('web-scraper-response-modal')?.remove();
  }
  
  const modal = document.createElement('div');
  modal.id = 'web-scraper-response-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
    z-index: 1000000; font-family: -apple-system, system-ui, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: #1e293b; color: #e2e8f0; padding: 24px; border-radius: 12px;
    width: 85%; max-width: 800px; max-height: 85%; overflow: hidden; display: flex; flex-direction: column; gap: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); border: 1px solid #334155;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #334155; padding-bottom: 12px;';
  
  const title = document.createElement('div');
  title.style.cssText = 'font-weight: bold; font-size: 16px; color: #38bdf8; word-break: break-all; padding-right: 20px;';
  title.textContent = `${requestData.method} ${requestData.url}`;

  const closeBtnTop = document.createElement('button');
  closeBtnTop.innerHTML = '&times;';
  closeBtnTop.style.cssText = 'background:none; border:none; color:#9ca3af; font-size:24px; cursor:pointer; line-height:1;';
  closeBtnTop.onclick = () => modal.remove();

  header.appendChild(title);
  header.appendChild(closeBtnTop);

  const scrollArea = document.createElement('div');
  scrollArea.style.cssText = 'overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px; padding-right: 8px;';

  const bodySection = document.createElement('div');
  bodySection.innerHTML = `<div style="font-weight:bold; margin-bottom:6px; font-size:13px; color:#9ca3af;">Request Body</div>
    <pre style="background:#0f172a; padding:12px; border-radius:6px; margin:0; font-family:monospace; font-size:12px; white-space:pre-wrap; word-break:break-all; border:1px solid #1e293b;">${requestData.body || '(Empty)'}</pre>`;
  
  const resSection = document.createElement('div');
  let formattedResponse = requestData.response || 'No response captured or request still pending...';
  try {
    const json = JSON.parse(formattedResponse);
    formattedResponse = JSON.stringify(json, null, 2);
  } catch (e) {}
  resSection.innerHTML = `<div style="font-weight:bold; margin-bottom:6px; font-size:13px; color:#9ca3af;">Response Body (Server Answer)</div>
    <pre style="background:#0f172a; padding:12px; border-radius:6px; margin:0; font-family:monospace; font-size:12px; white-space:pre-wrap; word-break:break-all; color:#34d399; border:1px solid #1e293b;">${formattedResponse}</pre>`;

  scrollArea.appendChild(bodySection);
  scrollArea.appendChild(resSection);

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex; justify-content:flex-end; padding-top: 12px; border-top: 1px solid #334155;';
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close Preview';
  closeBtn.style.cssText = 'padding: 8px 16px; background: #334155; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;';
  closeBtn.onclick = () => modal.remove();

  footer.appendChild(closeBtn);

  content.appendChild(header);
  content.appendChild(scrollArea);
  content.appendChild(footer);
  modal.appendChild(content);
  document.body.appendChild(modal);
};

// Create a small UI overlay to show what we are picking
const showOverlay = (target: string) => {
  if (activeOverlay) activeOverlay.remove();
  activeOverlay = document.createElement('div');
  activeOverlay.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    background: #1f2937;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    z-index: 999999;
    font-family: -apple-system, system-ui, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
    width: 280px;
    gap: 0;
  `;

  let label = 'Element';
  if (target === 'listSelector') label = 'List Element';
  if (target === 'loadMoreSelector') label = 'Load More (더보기) Button';
  if (target === 'detailSelector') label = 'Detail Element';
  if (target === 'apiSniffer') label = 'API Sniffer (스펙 버튼 클릭)';
  
  activeOverlay.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <span>Picking <strong>${label}</strong></span>
      <button id="web-scraper-cancel-picker" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Cancel</button>
    </div>
    <div style="font-size:12px; color:#9ca3af; margin-bottom:4px;">Click an element to select.</div>
    <div id="web-scraper-sniff-status" style="display:${target === 'apiSniffer' ? 'block' : 'none'}; margin-top:8px; border-top:1px solid #374151; padding-top:8px;">
       <div style="display:flex; justify-content:space-between; font-weight:bold;">
         <span>Captured Requests</span>
         <span id="web-scraper-sniff-count" style="color:#10b981;">0</span>
       </div>
       <div class="web-scraper-timer-container" id="web-scraper-timer-wrap">
         <div class="web-scraper-timer-progress" id="web-scraper-timer-bar"></div>
       </div>
       <div id="web-scraper-sniff-log" class="web-scraper-sniffer-log"></div>
    </div>
  `;

  document.body.appendChild(activeOverlay);

  document.getElementById('web-scraper-cancel-picker')?.addEventListener('click', stopPicking);
};

const showRecipeModal = (ruleJson: any) => {
  if (document.getElementById('web-scraper-recipe-modal')) {
    document.getElementById('web-scraper-recipe-modal')?.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'web-scraper-recipe-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center;
    z-index: 999999; font-family: -apple-system, system-ui, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white; padding: 28px; border-radius: 16px; max-width: 900px; width: 95%;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); display: flex; flex-direction: row; gap: 28px;
    max-height: 85vh; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);
  `;

  // --- 좌측 컬럼: AI 판독 결과 ---
  const leftCol = document.createElement('div');
  leftCol.style.cssText = 'flex: 1.3; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; padding-right: 10px;';

  const typeColor = ruleJson.renderingType === 'CSR' ? '#3b82f6' : '#10b981';

  // Title Row
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
  
  const h2 = document.createElement('h2');
  h2.style.cssText = 'margin:0; font-size:1.5rem; color:#1e293b; font-weight: 800;';
  h2.textContent = '🔍 글로벌 사이트 판독 리포트';
  
  const badge = document.createElement('span');
  badge.style.cssText = `background:${typeColor}20; color:${typeColor}; padding:6px 12px; border-radius:8px; font-size:13px; font-weight:bold; border: 1px solid ${typeColor}40;`;
  badge.textContent = `${ruleJson.renderingType} 방식`;
  
  titleRow.appendChild(h2);
  titleRow.appendChild(badge);
  leftCol.appendChild(titleRow);

  // Diagnosis Box
  const diagBox = document.createElement('div');
  diagBox.style.cssText = `background:#f8fafc; padding:18px; border-radius:10px; border-left:5px solid ${typeColor};`;
  
  const diagTitle = document.createElement('strong');
  diagTitle.style.cssText = 'display:block; margin-bottom:8px; color:#1e293b; font-size: 15px;';
  diagTitle.textContent = '🤖 AI 판독 근거';
  
  const diagText = document.createElement('p');
  diagText.style.cssText = 'margin:0; font-size:14px; color:#475569; line-height:1.6;';
  diagText.textContent = ruleJson.diagnosis_ko || "판독 근거를 생성하지 못했습니다.";
  
  diagBox.appendChild(diagTitle);
  diagBox.appendChild(diagText);
  leftCol.appendChild(diagBox);

  // Rule Box
  const ruleBox = document.createElement('div');
  ruleBox.style.cssText = 'font-size:13px; color:#64748b;';
  
  const ruleTitle = document.createElement('strong');
  ruleTitle.style.cssText = 'display:block; margin-bottom:8px; color:#1e293b;';
  ruleTitle.textContent = '📋 추출 규칙 상세 (Extraction Rule)';
  
  const pre = document.createElement('pre');
  pre.style.cssText = 'background:#0f172a; color:#34d399; padding:16px; border-radius:10px; overflow:auto; max-height:250px; margin:0; font-family:monospace; line-height:1.5; border: 1px solid #1e293b;';
  pre.textContent = JSON.stringify(ruleJson, null, 2);
  
  ruleBox.appendChild(ruleTitle);
  ruleBox.appendChild(pre);
  leftCol.appendChild(ruleBox);

  // Buttons Row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; justify-content:flex-end; gap:12px; margin-top: auto; padding-top: 10px;';
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '닫기';
  closeBtn.style.cssText = 'padding: 10px 20px; background: #f1f5f9; color: #475569; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: background 0.2s;';
  closeBtn.onclick = () => modal.remove();
  closeBtn.onmouseover = () => closeBtn.style.background = '#e2e8f0';
  closeBtn.onmouseout = () => closeBtn.style.background = '#f1f5f9';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '규칙 저장하기';
  saveBtn.style.cssText = `padding: 10px 24px; background: ${typeColor}; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; box-shadow: 0 4px 6px -1px ${typeColor}40; transition: all 0.2s;`;
  saveBtn.onclick = () => {
    chrome.storage.sync.set({ [`rule_${window.location.hostname}`]: ruleJson }, () => {
      showToast("💾 규칙이 브라우저에 저장되었습니다.", 3000);
      modal.remove();
      stopPicking();
    });
  };
  saveBtn.onmouseover = () => saveBtn.style.transform = 'translateY(-1px)';
  saveBtn.onmouseout = () => saveBtn.style.transform = 'translateY(0)';

  btnRow.appendChild(closeBtn);
  btnRow.appendChild(saveBtn);
  leftCol.appendChild(btnRow);

  // --- 우측 컬럼: 실시간 수집 내역 ---
  const rightCol = document.createElement('div');
  rightCol.style.cssText = 'flex: 0.7; display: flex; flex-direction: column; gap: 14px; border-left: 1px solid #f1f5f9; padding-left: 24px; overflow-y: auto;';

  const netTitle = document.createElement('h3');
  netTitle.style.cssText = 'margin:0; font-size:1.1rem; color:#1e293b; display:flex; align-items:center; gap:8px;';
  netTitle.innerHTML = `🌐 Captured Network <span style="background:#f1f5f9; color:#64748b; padding:2px 8px; border-radius:10px; font-size:12px;">${sniffedRequests.length}</span>`;

  const netDesc = document.createElement('p');
  netDesc.textContent = 'AI 분석의 근거가 된 통신 목록입니다. 클릭하여 상세 데이터를 확인하세요.';
  netDesc.style.cssText = 'margin:0; font-size:12px; color:#94a3b8; line-height:1.4;';

  const netList = document.createElement('div');
  netList.style.cssText = 'display:flex; flex-direction:column; gap:10px;';

  sniffedRequests.forEach(req => {
    const item = document.createElement('div');
    item.style.cssText = 'background:#f8fafc; padding:12px; border-radius:10px; font-size:12px; cursor:pointer; border:1px solid #f1f5f9; transition:all 0.2s; position:relative;';
    item.onmouseover = () => {
      item.style.background = 'white';
      item.style.borderColor = typeColor;
      item.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
    };
    item.onmouseout = () => {
      item.style.background = '#f8fafc';
      item.style.borderColor = '#f1f5f9';
      item.style.boxShadow = 'none';
    };
    item.onclick = () => showResponsePreview(req);

    const isComplete = !!req.response;
    const statusText = isComplete ? 'SUCCESS' : 'PENDING';
    const statusColor = isComplete ? '#10b981' : '#f59e0b';

    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
        <span style="font-weight:800; color:${typeColor}; font-family:monospace; padding:2px 6px; background:${typeColor}10; border-radius:4px;">${req.method}</span>
        <span style="font-size:10px; font-weight:bold; color:${statusColor}; background:${statusColor}15; padding:2px 6px; border-radius:4px;">${statusText}</span>
      </div>
      <div style="color:#1e293b; font-weight:500; word-break:break-all; line-height:1.3; margin-bottom:8px;">${req.url.split('/').pop()?.split('?')[0] || req.url}</div>
      <div style="font-size:11px; color:#94a3b8; display:flex; align-items:center; gap:4px;">
        🔍 Click to view Body
      </div>
    `;
    netList.appendChild(item);
  });

  rightCol.appendChild(netTitle);
  rightCol.appendChild(netDesc);
  rightCol.appendChild(netList);

  content.appendChild(leftCol);
  content.appendChild(rightCol);
  modal.appendChild(content);

  document.body.appendChild(modal);
  
  // Cleanup overlays if any
  const oldLog = document.getElementById('web-scraper-sniff-log');
  const oldTimer = document.getElementById('web-scraper-timer-wrap');
  if (oldLog) oldLog.style.display = 'none';
  if (oldTimer) oldTimer.style.display = 'none';
};

const removeOverlay = () => {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
};

// Utility to generate a unique CSS Selector for an element
const getUniqueSelector = (el: HTMLElement): string => {
  if (el.tagName.toLowerCase() === 'html') return 'html';
  if (el.tagName.toLowerCase() === 'body') return 'body';

  if (el.id) {
    const idSelector = `#${el.id}`;
    if (document.querySelectorAll(idSelector).length === 1) {
      return idSelector;
    }
  }

  let selector = el.tagName.toLowerCase();

  if (el.classList.length > 0) {
    const classes = Array.from(el.classList).filter(c => !c.includes('web-scraper-highlight'));
    if (classes.length > 0) {
      selector += `.${classes.join('.')}`;
    }
  }

  const matches = document.querySelectorAll(selector);
  if (matches.length === 1 || (matches.length > 1 && Array.from(matches).indexOf(el) === 0)) {
    // fallback
  }

  if (el.parentElement && el.parentElement.tagName.toLowerCase() !== 'body') {
    return `${getUniqueSelector(el.parentElement)} > ${selector}`;
  }

  return selector;
};

const getGenericSelector = (el: HTMLElement): string => {
  let selector = el.tagName.toLowerCase();

  if (el.classList.length > 0) {
    const classes = Array.from(el.classList).filter(c => !c.includes('web-scraper-highlight') && !c.includes('selected') && !c.includes('active'));
    if (classes.length > 0) {
      selector += `.${classes.join('.')}`;
    }
  }

  // If no classes exist, we need parent context to avoid selecting every span/div on the page
  if (selector === el.tagName.toLowerCase() && el.parentElement && el.parentElement.tagName.toLowerCase() !== 'body') {
    return `${getUniqueSelector(el.parentElement)} > ${selector}`;
  }

  return selector;
};

const handleMouseOver = (e: MouseEvent) => {
  if (!isPicking) return;
  e.stopPropagation();

  if (hoveredElement) {
    hoveredElement.classList.remove('web-scraper-highlight');
  }

  const target = e.target as HTMLElement;
  if (activeOverlay && activeOverlay.contains(target)) return;

  hoveredElement = target;
  target.classList.add('web-scraper-highlight');
};

const handleMouseOut = (_e: MouseEvent) => {
  if (!isPicking) return;
  if (hoveredElement) {
    hoveredElement.classList.remove('web-scraper-highlight');
    hoveredElement = null;
  }
};

const handleClick = (e: MouseEvent) => {
  if (!isPicking || !currentTarget) return;
  
  const target = e.target as HTMLElement;
  if (activeOverlay && activeOverlay.contains(target)) return;

  if (currentTarget === 'apiSniffer') {
    // 1. Sniffing is ALREADY active from startPicking, but we reset for this specific click context
    // This allows us to catch the absolute first frame of the click's request
    
    showToast("🛰️ [WEB SCRAPER] 버튼 클릭 감지! 통신 내역을 분석용으로 낚아챕니다.", 3000);

    // Reset UI overlay state (but don't reset sniffedRequests yet, keep what we caught since mode entry)
    const timerWrap = document.getElementById('web-scraper-timer-wrap');
    const timerBar = document.getElementById('web-scraper-timer-bar');
    if (timerWrap) timerWrap.style.display = 'block';
    // Note: we don't clear logContainer here to preserve any early-caught request

    let startTime = Date.now();
    const duration = 2500;
    
    const updateTimer = () => {
        if (!isSniffingActive) return;
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / duration) * 100, 100);
        if (timerBar) timerBar.style.width = `${progress}%`;
        if (progress < 100) {
            requestAnimationFrame(updateTimer);
        }
    };
    requestAnimationFrame(updateTimer);

    // Get context asynchronously but don't block the click from reaching the page
    chrome.storage.sync.get(['listSelector', 'detailSelector'], (res) => {
        if (!res.listSelector) {
           alert("List Selector를 먼저 설정해주세요.");
           stopPicking();
           return;
        }
        
        const parentItem = target.closest(res.listSelector) as HTMLElement;
        const beforeHtml = parentItem ? parentItem.outerHTML : "";
        const detailSelectorHtml = res.detailSelector ? (document.querySelector(res.detailSelector) as HTMLElement)?.outerHTML || "" : "";
        
        let targetAreaHtml = "";
        const anchor = target.closest('a');
        if (anchor && anchor.hash && anchor.hash.startsWith('#')) {
            const targetId = anchor.hash.substring(1);
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetAreaHtml = targetEl.outerHTML;
        }

        // Wait for 2.5 seconds to capture all triggered requests
        setTimeout(() => {
           isSniffingActive = false;
           stopPicking();
           
           const afterHtml = parentItem ? parentItem.outerHTML : "";
           const beforeMarkdown = beforeHtml ? turndownService.turndown(beforeHtml) : "";
           const afterMarkdown = afterHtml ? turndownService.turndown(afterHtml) : "";
           const detailHintMarkdown = detailSelectorHtml ? turndownService.turndown(detailSelectorHtml) : "";
           const targetAreaMarkdown = targetAreaHtml ? turndownService.turndown(targetAreaHtml) : "";

           showToast("🤖 통신 내역 수집 완료! 제미나이가 분석 중입니다...", 60000);
           
           chrome.runtime.sendMessage({
               action: 'analyze_api_rule',
               requestPayloads: sniffedRequests, 
               beforeHtml: beforeMarkdown,
               afterHtml: afterMarkdown,
               detailHintHtml: detailHintMarkdown,
               targetAreaHtml: targetAreaMarkdown
           });
        }, 2500);
    });
    
    // IMPORTANT: DO NOT call e.preventDefault() here! 
    return; 
  }

  e.preventDefault();
  e.stopPropagation();

  const selector = currentTarget === 'loadMoreSelector' ? getUniqueSelector(target) : getGenericSelector(target);
  
  chrome.storage.sync.set({ [currentTarget]: selector }, () => {
    alert(`Saved ${currentTarget}: \n${selector}`);
    stopPicking();
  });
};

const startPicking = (target: 'listSelector' | 'loadMoreSelector' | 'detailSelector' | 'apiSniffer') => {
  isPicking = true;
  currentTarget = target;
  injectStyles();
  showOverlay(target);

  if (target === 'apiSniffer') {
    isSniffingActive = true;
    sniffedRequests = [];
    console.log("🛰️ [WEB SCRAPER] Early sniffing activated. Watching all network traffic...");
  }

  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  document.addEventListener('click', handleClick, true);
};

const stopPicking = () => {
  isPicking = false;
  currentTarget = null;
  removeOverlay();

  if (hoveredElement) {
    hoveredElement.classList.remove('web-scraper-highlight');
    hoveredElement = null;
  }

  document.removeEventListener('mouseover', handleMouseOver, true);
  document.removeEventListener('mouseout', handleMouseOut, true);
  document.removeEventListener('click', handleClick, true);
};

// Automation and Extraction logic
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const performExtraction = async () => {
  const result: { [key: string]: any } = await new Promise((resolve) => {
    chrome.storage.sync.get(['listSelector', 'loadMoreSelector', 'detailSelector'], resolve);
  });

  if (!result.listSelector) {
    showToast('⚠️ List Selector is missing! Please configure via the extension popup.', 5000);
    return;
  }

  // 1. Click "Load More" repeatedly if defined
  if (result.loadMoreSelector) {
    let clickCount = 0;
    while (clickCount < 30) {
      const btn = document.querySelector(result.loadMoreSelector) as HTMLElement;
      if (!btn || btn.offsetParent === null) break; // disappear or hidden
      showToast(`⏳ Clicking "Load More" (${clickCount + 1}/30)...`);
      btn.click();
      clickCount++;
      await pause(1500); // Wait for content to load
    }
  }

  // 2. Extract content
  showToast('🛠️ Extracting item data from page...');
  await pause(1000);

  // 💡 [NEW] Save context for Python script generation early to avoid context errors
  chrome.storage.sync.set({ 
    lastScrapedUrl: window.location.href,
    listSelector: result.listSelector,
    detailSelector: result.detailSelector
  });

  const listItems = document.querySelectorAll(result.listSelector);
  if (listItems.length === 0) {
    showToast('⚠️ No items found using the specified list selector.', 5000);
    return;
  }

  const extractedData: string[] = [];
  const MAX_ITEMS_TO_TEST = 3;
  const processList = Array.from(listItems).slice(0, MAX_ITEMS_TO_TEST);

  for (let i = 0; i < processList.length; i++) {
    const item = processList[i] as HTMLElement;
    let htmlContent = item.outerHTML;

    // Narrow down if detailSelector is provided
    if (result.detailSelector) {
      const detailItem = item.querySelector(result.detailSelector);
      if (detailItem) htmlContent = detailItem.outerHTML;
    }

    try {
      const baseMarkdown = turndownService.turndown(htmlContent);
      let combinedMarkdown = baseMarkdown;

      // --- Deep Fetch API/SSR Logic ---
      const { apiExtractionRule } = await new Promise<any>(res => chrome.storage.sync.get(['apiExtractionRule'], res));
      
      let goodsId = '';
      let customApiUrl = '';
      let customBodyParamsStr = '';
      let renderingType = 'SAMSUNG_LEGACY';
      
      if (apiExtractionRule) {
        try {
          const rule = JSON.parse(apiExtractionRule);
          renderingType = rule.renderingType || 'CSR';
          
          if (renderingType === 'CSR') {
            const p = rule.urlParams[0];
            const el = item.matches(p.domSelector) ? item : item.querySelector(p.domSelector);
            if (el) {
              goodsId = p.domAttribute === 'textContent' ? el.textContent || '' : el.getAttribute(p.domAttribute) || '';
            }
            customApiUrl = rule.apiUrl;
            
            const params = new URLSearchParams(rule.staticBodyParams || {});
            params.append(p.targetParam, goodsId);
            customBodyParamsStr = params.toString();
          } else if (renderingType === 'SSR') {
            const selectorToUse = result.detailSelector || rule.specDomSelector;
            
            if (selectorToUse) {
              let specEl = item.querySelector(selectorToUse) as HTMLElement;
              if (!specEl && selectorToUse.startsWith('#')) {
                  specEl = document.querySelector(selectorToUse) as HTMLElement;
              }
              
              if (specEl) {
                // --- Auto Click Logic for Hidden SSR Content ---
                if (rule.requiresClick) {
                  const expandBtn = specEl.querySelector('button, .cta, a[role="button"], [data-expand-text]') as HTMLElement;
                  if (expandBtn) {
                    console.log("🖱️ [WEB SCRAPER] Auto-clicking expand button for SSR content...");
                    expandBtn.click();
                    await pause(1000); // Increased wait for slower global regions
                  }
                }

                // 🌟 Harden: Use Samsung Precision Parser first, then fallback to Turndown
                const samsungSpecMarkdown = samsungSpecificParser(specEl);
                if (samsungSpecMarkdown) {
                  combinedMarkdown += `\n\n### Specialized Spec Capture (Samsung-Specific):\n${samsungSpecMarkdown}`;
                } else {
                  const specMarkdown = turndownService.turndown(specEl.outerHTML);
                  combinedMarkdown += `\n\n### SSR Detailed Specs (Source: ${selectorToUse}):\n${specMarkdown}`;
                }
                showToast(`🔍 SSR 스펙 데이터 캡처 성공! (${i + 1})`);
              }
            }
          }
        } catch (e) {
          console.error("Rule parse error", e);
        }
      }

      // --- Specialized Samsung Korea CSR Fallback (Multi-ID Scanner) ---
      if (renderingType === 'SAMSUNG_LEGACY' || (renderingType === 'CSR' && window.location.host.includes('samsung.com/sec'))) {
        const idElements = item.querySelectorAll('[data-goods-id]');
        const uniqueIds = new Set<string>();
        const idData: Array<{id: string, nm: string, tp: string}> = [];
        
        idElements.forEach(el => {
          const gid = el.getAttribute('data-goods-id');
          if (gid && !uniqueIds.has(gid)) {
            uniqueIds.add(gid);
            idData.push({
              id: gid,
              nm: el.getAttribute('data-goods-nm') || '',
              tp: el.getAttribute('data-goods-tp-cd') || '10'
            });
          }
        });

        // Fallback for current item if no children have IDs
        if (idData.length === 0) {
          const gid = item.getAttribute('data-goods-id');
          if (gid) idData.push({ id: gid, nm: item.getAttribute('data-goods-nm') || '', tp: item.getAttribute('data-goods-tp-cd') || '10' });
        }

        if (idData.length > 0) {
          showToast(`📡 [SAMSUNG KOREA] Found ${idData.length} product IDs. Fetching all...`);
          
          const fetchPromises = idData.map(async (data) => {
            const apiUrl = data.nm ? 'https://www.samsung.com/sec/xhr/goods/getGoodsSpecList' : 'https://www.samsung.com/sec/xhr/goods/goodsSpec';
            const params = new URLSearchParams();
            params.append('goodsId', data.id);
            params.append('goodsTpCd', data.tp);
            if (data.nm) params.append('goodsNm', data.nm);
            params.append('adminYn', '');
            
            try {
              const res = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                  'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                  'x-requested-with': 'XMLHttpRequest'
                },
                body: params.toString()
              });
              if (res.ok) {
                const text = await res.text();
                // Basic cleanup and parsing
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const samsungMarkdown = samsungSpecificParser(doc.body);
                return `\n\n--- [ PRODUCT: ${data.id} (${data.nm || 'Unknown'}) ] ---\n${samsungMarkdown || turndownService.turndown(doc.body.outerHTML)}`;
              }
            } catch (err) {
              console.error('Fetch error for ID', data.id, err);
            }
            return '';
          });

          const results = await Promise.all(fetchPromises);
          combinedMarkdown += results.filter(r => r).join('\n');
          renderingType = 'CSR_COMPLETED'; // Stop generic fetch from running
        }
      }
    
      if (renderingType === 'CSR' && goodsId && customApiUrl) {
        showToast(`⏳ 딥-페치(CSR) 스펙 불러오는 중... (${i + 1}/${processList.length})`);
        try {
          const specRes = await fetch(customApiUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
              'x-requested-with': 'XMLHttpRequest'
            },
            body: customBodyParamsStr
          });

          if (specRes.ok) {
            const specDataBlob = await specRes.text();
            let specMarkdown = "";
            
            // Try parsing as JSON first, fallback to HTML
            try {
              const specJson = JSON.parse(specDataBlob);
              specMarkdown = "\n\n### API Specs (JSON):\n" + JSON.stringify(specJson, null, 2);
            } catch {
              const parser = new DOMParser();
              const doc = parser.parseFromString(specDataBlob, 'text/html');
              // 🌟 Harden: Also use Samsung Specific Parser on API-returned HTML
              const samsungApiMarkdown = samsungSpecificParser(doc.body);
              if (samsungApiMarkdown) {
                specMarkdown = "\n\n### Specialized API Spec Capture:\n" + samsungApiMarkdown;
              } else {
                const specTable = doc.querySelector('.spec-table, table, .pdd32-product-spec') || doc.body;
                specMarkdown = "\n\n### API Detailed Specs (HTML View):\n" + turndownService.turndown(specTable.outerHTML);
              }
            }
            combinedMarkdown += specMarkdown;
          }
        } catch (fetchErr) {
          console.error('Failed to deep fetch specs for', goodsId, fetchErr);
        }
        await pause(300);
      }

      extractedData.push(combinedMarkdown);
    } catch (e) {
      console.error('Extraction item error', e);
      extractedData.push(item.textContent || '');
    }
  }

  showToast(`🤖 Sending ${extractedData.length} items to Gemini AI for final mapping...`);

  chrome.runtime.sendMessage({
    action: 'process_with_llm',
    data: extractedData
  });
};

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'start_picking' && request.target) {
    startPicking(request.target);
    sendResponse({ success: true });
  } else if (request.action === 'start_extraction') {
    performExtraction().catch(err => {
      console.error(err);
      showToast('❌ Extraction failed. Check console for details.', 5000);
    });
    sendResponse({ success: true, message: 'Extraction running in background' });
  } else if (request.action === 'extraction_complete') {
    showToast('✅ Extraction complete!', 3000);
    sendResponse({ success: true });
  } else if (request.action === 'sniffing_rule_saved') {
    // 💡 Detailed console logging for diagnostics
    console.group("🔍 [WEB SCRAPER] AI 글로벌 사이트 판독 결과");
    console.log("판독 방식:", request.ruleJson.renderingType);
    console.log("판독 근거:", request.ruleJson.diagnosis_ko);
    console.log("추출 규칙:", request.ruleJson);
    console.groupEnd();
    
    showToast(`🎯 Rule Generated! (Check Console for details)`, 4000);
    showRecipeModal(request.ruleJson);
    sendResponse({ success: true });
  } else if (request.action === 'sniffing_rule_error') {
    showToast(`❌ AI Error: ${request.message}`, 8000);
    sendResponse({ success: true });
  } else if (request.action === 'extraction_error') {
    showToast(`❌ Error: ${request.message}`, 8000);
    sendResponse({ success: true });
  }
  return true;
});
