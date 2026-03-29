// Content script for the Chrome Extension
import TurndownService from 'turndown';

let isPicking = false;
let currentTarget: 'listSelector' | 'loadMoreSelector' | 'detailSelector' | null = null;
let hoveredElement: HTMLElement | null = null;
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

  e.preventDefault();
  e.stopPropagation();

  const target = e.target as HTMLElement;
  if (activeOverlay && activeOverlay.contains(target)) return;

  const selector = currentTarget === 'loadMoreSelector' ? getUniqueSelector(target) : getGenericSelector(target);

  chrome.storage.sync.set({ [currentTarget]: selector }, () => {
    alert(`Saved ${currentTarget}: \n${selector}`);
    stopPicking();
  });
};

const startPicking = (target: 'listSelector' | 'loadMoreSelector' | 'detailSelector') => {
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

      // --- Deep Fetch API Logic (Samsung Specific) ---
      let goodsId = item.getAttribute('data-goods-id') || '';
      let goodsNm = item.getAttribute('data-goods-nm') || '';

      if (!goodsId) {
        const checkboxWrap = item.querySelector('[data-goods-id]');
        if (checkboxWrap) {
          goodsId = checkboxWrap.getAttribute('data-goods-id') || '';
          goodsNm = checkboxWrap.getAttribute('data-goods-nm') || '';
        }
      }

      if (goodsId) {
        showToast(`⏳ 딥-페치 스펙 불러오는 중... (${i + 1}/${processList.length})`);
        try {
          const specRes = await fetch('https://www.samsung.com/sec/xhr/goods/getGoodsSpecList', {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: new URLSearchParams({
              goodsId: goodsId,
              goodsTpCd: '10',
              goodsNm: goodsNm,
              adminYn: '',
              taskId: '',
              taskDtlNo: ''
            })
          });

          if (specRes.ok) {
            const specHtml = await specRes.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(specHtml, 'text/html');
            const specTable = doc.querySelector('.spec-table');
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
  } else if (request.action === 'extraction_error') {
    showToast(`❌ Error: ${request.message}`, 8000);
  }
  return true;
});
