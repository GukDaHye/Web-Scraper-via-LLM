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

  sniffedRequests.push(data);
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
    align-items: center;
    gap: 12px;
  `;

  let label = 'Element';
  if (target === 'listSelector') label = 'List Element';
  if (target === 'loadMoreSelector') label = 'Load More (더보기) Button';
  if (target === 'detailSelector') label = 'Detail Element';
  if (target === 'apiSniffer') label = 'API Sniffer (스펙 버튼 클릭)';
  activeOverlay.innerHTML = `
    <span>Picking <strong>${label}</strong>. Click an element to select.</span>
    <button id="web-scraper-cancel-picker" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Cancel</button>
  `;

  document.body.appendChild(activeOverlay);

  document.getElementById('web-scraper-cancel-picker')?.addEventListener('click', stopPicking);
};

const showRecipeModal = (ruleJson: any) => {
  const modal = document.createElement('div');
  modal.id = 'web-scraper-recipe-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
    z-index: 999999; font-family: -apple-system, system-ui, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white; padding: 24px; border-radius: 12px; max-width: 550px; width: 90%;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 16px;
  `;

  const typeColor = ruleJson.renderingType === 'CSR' ? '#3b82f6' : '#10b981';

  // Title Row
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
  
  const h2 = document.createElement('h2');
  h2.style.cssText = 'margin:0; font-size:1.4rem; color:#111;';
  h2.textContent = '🔍 글로벌 사이트 판독 리포트';
  
  const badge = document.createElement('span');
  badge.style.cssText = `background:${typeColor}; color:white; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:bold;`;
  badge.textContent = `${ruleJson.renderingType} 방식`;
  
  titleRow.appendChild(h2);
  titleRow.appendChild(badge);
  content.appendChild(titleRow);

  // Diagnosis Box
  const diagBox = document.createElement('div');
  diagBox.style.cssText = `background:#f8fafc; padding:15px; border-radius:8px; border-left:4px solid ${typeColor};`;
  
  const diagTitle = document.createElement('strong');
  diagTitle.style.cssText = 'display:block; margin-bottom:5px; color:#1e293b;';
  diagTitle.textContent = '🤖 AI 판독 근거';
  
  const diagText = document.createElement('p');
  diagText.style.cssText = 'margin:0; font-size:14px; color:#475569; line-height:1.5;';
  diagText.textContent = ruleJson.diagnosis_ko || "판독 근거를 생성하지 못했습니다.";
  
  diagBox.appendChild(diagTitle);
  diagBox.appendChild(diagText);
  content.appendChild(diagBox);

  // Rule Box
  const ruleBox = document.createElement('div');
  ruleBox.style.cssText = 'font-size:13px; color:#64748b;';
  
  const ruleTitle = document.createElement('strong');
  ruleTitle.style.cssText = 'display:block; margin-bottom:5px;';
  ruleTitle.textContent = '📋 추출 규칙 상세';
  
  const pre = document.createElement('pre');
  pre.style.cssText = 'background:#1e293b; color:#e2e8f0; padding:10px; border-radius:6px; overflow:auto; max-height:150px; margin:0;';
  pre.textContent = JSON.stringify(ruleJson, null, 2);
  
  ruleBox.appendChild(ruleTitle);
  ruleBox.appendChild(pre);
  content.appendChild(ruleBox);

  // Buttons Row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; justify-content:flex-end; gap:10px; margin-top:10px;';
  
  const saveBtn = document.createElement('button');
  saveBtn.style.cssText = 'padding:10px 20px; background:#3b82f6; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;';
  saveBtn.textContent = '✅ 확인 및 저장';
  saveBtn.onclick = () => {
     chrome.storage.sync.set({ apiExtractionRule: JSON.stringify(ruleJson) }, () => {
        showToast("🎯 추출 규칙이 성공적으로 저장되었습니다! 이제 추출을 시작하세요.", 4000);
        modal.remove();
     });
  };
  
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'padding:10px 20px; background:#f1f5f9; color:#475569; border:none; border-radius:6px; cursor:pointer;';
  closeBtn.textContent = '닫기';
  closeBtn.onclick = () => {
     modal.remove();
  };
  
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(closeBtn);
  content.appendChild(btnRow);

  modal.appendChild(content);
  document.body.appendChild(modal);
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
    // 1. Immediately activate sniffing so the first click's request is caught
    isSniffingActive = true;
    sniffedRequests = [];
    
    showToast("🛰️ [WEB SCRAPER] 발견 모드 가동 중... 클릭 직후의 통신을 낚아챕니다!", 3000);

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
