// Content script for the Chrome Extension
import TurndownService from 'turndown';

let isPicking = false;
let currentTarget: 'listSelector' | 'loadMoreSelector' | 'detailSelector' | 'apiSniffer' | null = null;
let hoveredElement: HTMLElement | null = null;

let isSniffingActive = false;
let sniffedRequests: any[] = [];

const injectNetworkSniffer = () => {
  if (document.getElementById('web-scraper-network-sniffer')) return;
  const script = document.createElement('script');
  script.id = 'web-scraper-network-sniffer';
  script.textContent = `
    (function() {
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        let url = '';
        let body = '';
        const req = args[0];
        if (typeof req === 'string') { url = req; } 
        else if (req instanceof Request) { url = req.url; }
        
        let method = 'GET';
        if (args[1] && args[1].method) { method = args[1].method; } 
        else if (req instanceof Request) { method = req.method; }

        if (args[1] && args[1].body) {
          if (typeof args[1].body === 'string') { body = args[1].body; } 
          else if (args[1].body instanceof URLSearchParams) { body = args[1].body.toString(); }
          else if (args[1].body instanceof FormData) { /* simplified */ }
        }
        
        window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
          detail: { type: 'fetch', url, method, body }
        }));
        
        return originalFetch.apply(this, args);
      };

      const originalXhrOpen = XMLHttpRequest.prototype.open;
      const originalXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._method = method; this._url = url;
        return originalXhrOpen.apply(this, [method, url, ...args]);
      };
      XMLHttpRequest.prototype.send = function(body) {
        let parsedBody = '';
        if (typeof body === 'string') { parsedBody = body; } 
        else if (body instanceof URLSearchParams) { parsedBody = body.toString(); }
        window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
          detail: { type: 'xhr', url: this._url, method: this._method, body: parsedBody }
        }));
        return originalXhrSend.apply(this, [body]);
      };
    })();
  `;
  document.documentElement.appendChild(script);
};

injectNetworkSniffer();

window.addEventListener('__WEB_SCRAPER_NETWORK_HOOK', (e: Event) => {
  if (!isSniffingActive) return;
  const customEvent = e as CustomEvent;
  const data = customEvent.detail;
  
  const url = (data.url || '').toLowerCase();
  const ignoreWords = ['analytics', 'pixel', 'log', 'tracking', 'css', 'js', 'png', 'jpg'];
  if (ignoreWords.some(w => url.includes(w))) return;

  sniffedRequests.push(data);
});
let activeOverlay: HTMLDivElement | null = null;

const turndownService = new TurndownService({ headingStyle: 'atx' });

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
    chrome.storage.sync.get(['listSelector'], (res) => {
        if (!res.listSelector) {
           alert("List Selector를 먼저 설정해주세요.");
           stopPicking();
           return;
        }
        const parentItem = target.closest(res.listSelector) as HTMLElement;
        if (!parentItem) {
           alert("클릭한 버튼이 상품 카드의 내부(List Selector 영역)에 없습니다!");
           stopPicking();
           return;
        }
        
        isSniffingActive = true;
        sniffedRequests = [];
        showToast("🔍 버튼 클릭 통과. 2초 동안 통신을 캡처합니다...");
        
        setTimeout(() => {
           isSniffingActive = false;
           stopPicking();
           if (sniffedRequests.length === 0) {
              alert("2초 동안 감지된 유효한 API 통신이 없습니다.");
              return;
           }
           
           const lastReq = sniffedRequests[sniffedRequests.length - 1]; // 가장 유력
           showToast("🤖 통신 캐치완료! 제미나이가 매핑 규칙을 탐색합니다...", 60000); // 1 minute toast until done
           
           chrome.runtime.sendMessage({
               action: 'analyze_api_rule',
               requestPayload: lastReq,
               cardHtml: parentItem.outerHTML
           });
        }, 2000);
    });
    return; // allow the click to execute!
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

      // --- Deep Fetch API Logic ---
      const { apiExtractionRule } = await new Promise<any>(res => chrome.storage.sync.get(['apiExtractionRule'], res));
      
      let goodsId = '';
      let goodsNm = '';
      let customApiUrl = '';
      let customBodyParamsStr = '';
      
      if (apiExtractionRule) {
        try {
          const rule = JSON.parse(apiExtractionRule);
          const p = rule.urlParams[0];
          const el = item.matches(p.domSelector) ? item : item.querySelector(p.domSelector);
          if (el) {
            goodsId = p.domAttribute === 'textContent' ? el.textContent || '' : el.getAttribute(p.domAttribute) || '';
          }
          customApiUrl = rule.apiUrl;
          
          const params = new URLSearchParams(rule.staticBodyParams || {});
          params.append(p.targetParam, goodsId);
          customBodyParamsStr = params.toString();
        } catch (e) {
          console.error("Rule parse error", e);
        }
      }

      if (!goodsId) {
        // Fallback to Samsung hardcoded logic
        goodsId = item.getAttribute('data-goods-id') || '';
        goodsNm = item.getAttribute('data-goods-nm') || '';

        if (!goodsId) {
          const checkboxWrap = item.querySelector('[data-goods-id]');
          if (checkboxWrap) {
            goodsId = checkboxWrap.getAttribute('data-goods-id') || '';
            goodsNm = checkboxWrap.getAttribute('data-goods-nm') || '';
          }
        }
        
        customApiUrl = 'https://www.samsung.com/sec/xhr/goods/getGoodsSpecList';
        customBodyParamsStr = new URLSearchParams({
              goodsId: goodsId,
              goodsTpCd: '10',
              goodsNm: goodsNm,
              adminYn: '',
              taskId: '',
              taskDtlNo: ''
            }).toString();
      }
      
      if (goodsId) {
        showToast(`⏳ 딥-페치 스펙 불러오는 중... (${i + 1}/${processList.length})`);
        try {
          const specRes = await fetch(customApiUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: customBodyParamsStr
          });

          if (specRes.ok) {
            const specHtml = await specRes.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(specHtml, 'text/html');
            // If it's pure JSON or generic HTML without .spec-table, grab body directly
            const specTable = doc.querySelector('.spec-table') || doc.body;
            if (specTable) {
              const specMarkdown = turndownService.turndown(specTable.outerHTML);
              combinedMarkdown += `\n\n### Detailed Specs (Deep Fetch):\n${specMarkdown}`;
            }
          }
        } catch (fetchErr) {
          console.error('Failed to deep fetch specs for', goodsId, fetchErr);
        }
        await pause(200); // polite delay
      }

      extractedData.push(combinedMarkdown);
    } catch (e) {
      console.error('Turndown error', e);
      extractedData.push(item.textContent || '');
    }
  }

  // 3. Send back to Background Script to process with LLM
  showToast(`🤖 Sending ${extractedData.length} items to Gemini AI... This can take 10-30 seconds.`);

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
  } else if (request.action === 'sniffing_rule_saved') {
    showToast(`🎯 Rule Saved! ${request.ruleJson.urlParams[0].targetParam} => ${request.ruleJson.urlParams[0].domAttribute}`, 4000);
  } else if (request.action === 'sniffing_rule_error') {
    showToast(`❌ AI Error: ${request.message}`, 8000);
  } else if (request.action === 'extraction_error') {
    showToast(`❌ Error: ${request.message}`, 8000);
  }
  return true;
});
