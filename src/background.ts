// Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('Web Scraper Extension Installed');
});

const getApiConfig = (apiKey: string) => {
  const isSsafy = apiKey.startsWith('S14P');
  if (isSsafy) {
    return {
      url: 'https://gms.ssafy.io/gmsapi/generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey 
      } as Record<string, string>
    };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    headers: {
      'Content-Type': 'application/json'
    } as Record<string, string>
  };
};

const callGeminiAPI = async (apiKey: string, extractedItems: string[]) => {
  if (!apiKey) throw new Error('API Key missing');

  const chunkSize = 1; // Process 1 item at a time since Deep Specifications take up large LLM outputs
  let allResults: any[] = [];

  for (let i = 0; i < extractedItems.length; i += chunkSize) {
    const chunk = extractedItems.slice(i, i + chunkSize);
    const combinedMarkdown = chunk.map((item, index) => `--- Item ${i + index + 1} ---\n${item}`).join('\n\n');
    
    const prompt = `
      You are an intelligent web scraper data extractor.
      I will provide you with a list of extracted markdown sections representing items from a webpage.
      
      IMPORTANT:
      - Each item often contains a "Detailed Specs" or "SSR Detailed Specs" section at the end.
      - These sections contain the most critical technical data (Weight, Resolution, Power, Ports, etc.).
      - You MUST extract EVERY technical data point from these sections and include them in the resulting JSON object.
      - Do not summarize. Be as detailed as possible.
      - Return the result strictly as a valid JSON array of objects.
      
      Here is the data:
      ${combinedMarkdown}
    `;

    const config = getApiConfig(apiKey);
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API Error: ${err}`);
    }

    const result = await response.json();
    const textOutput = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!textOutput) throw new Error('No valid output text from Gemini');

    try {
      const chunkResult = JSON.parse(textOutput.trim());
      if (Array.isArray(chunkResult)) {
        allResults = allResults.concat(chunkResult);
      } else {
        allResults.push(chunkResult);
      }
    } catch (err) {
      console.error('Failed to parse JSON for chunk', textOutput);
      throw new Error('LLM did not return valid JSON for a chunk');
    }
  }

  return allResults;
};

chrome.runtime.onMessage.addListener((request, _sender, sendResponse): boolean => {
  if (request.action === 'process_with_llm') {
    const extractedData = request.data as string[];
    console.log(`Processing ${extractedData.length} items...`);

    chrome.storage.sync.get(['apiKey'], async (result) => {
      try {
        if (!result.apiKey) {
          throw new Error('Please configure your Gemini API Key in the extension option.');
        }

        const structuredData = await callGeminiAPI(result.apiKey, extractedData);

        // Store result for the results tab
        await chrome.storage.local.set({ extractionResult: structuredData });

        // Open Results Tab
        chrome.tabs.create({ url: chrome.runtime.getURL('result.html') });
        
        // Let the user know we finished via Chrome Notification
        if (chrome.notifications) {
          chrome.notifications.create(Date.now().toString(), {
            type: 'basic',
            // Using a placeholder fallback image for MV3 strictly
            iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            title: 'Extraction Complete!',
            message: `Successfully structured ${structuredData.length} items.`
          });
        }

        // Notify content script
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'extraction_complete' }).catch(() => {});
        }

      } catch (err: any) {
        console.error(err);
        if (chrome.notifications) {
          chrome.notifications.create(Date.now().toString(), {
            type: 'basic',
            iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            title: 'Extraction Failed',
            message: err.message
          });
        }

        // Notify content script
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'extraction_error', message: err.message }).catch(() => {});
        }
      }
    });

    sendResponse({ status: 'Processing started in background' });
  } else if (request.action === 'analyze_api_rule') {
    sendResponse({ status: 'processing' });
    chrome.storage.sync.get(['apiKey'], async (result) => {
      try {
        if (!result.apiKey) throw new Error('API Key missing. Please config in popup.');
        
        const payloads = request.requestPayloads || (request.requestPayload ? [request.requestPayload] : []);
        const payloadStr = payloads.length > 0 ? JSON.stringify(payloads, null, 2) : "NO_NETWORK_REQUEST_CAPTURED";
        
        const prompt = `--- PRODUCT CARD MARKDOWN BEFORE ---
${request.beforeHtml}

--- PRODUCT CARD MARKDOWN AFTER ---
${request.afterHtml}

--- HINT: USER PICKED DETAIL AREA (MARKDOWN) ---
${request.detailHintHtml || "NONE"}

--- HINT: CLICKED ANCHOR TARGET AREA (MARKDOWN) ---
${request.targetAreaHtml || "NONE"}

--- INTERCEPTED NETWORK LOGS ---
${payloadStr}

Your Job:
1. Determine if it's CSR (API fetch) or SSR (DOM content appears/hides) for getting product specifications.
2. For SAMSUNG regions: 
   - KOREA (sec.com) usually uses CSR via:
     * 'xhr/goods/goodsSpec' (for single specs)
     * 'xhr/goods/getGoodsSpecList' (for package/multiple specs)
     * Parameters: 'goodsId', 'goodsTpCd', 'goodsNm'.
   - GLOBAL (e.g. africa_en) usually uses SSR where specs are in 'pdd32' classes but hidden until 'Expand all' is clicked.
3. If CSR: identify the API URL, Method (usually POST for Korea) from the logs, and DOM mapping for 'goodsId'.
4. If SSR: identify 'specDomSelector' (look for 'pdd32-product-spec').
5. Set 'requiresClick' to true if the content is hidden by default.
6. Generate a Diagnosis in Korean (\`diagnosis_ko\`) explaining exactly why you chose this strategy for this specific region.
7. Return ONLY JSON.

Schema:
{
  "renderingType": "CSR" | "SSR",
  "apiUrl": "string (for CSR)",
  "specDomSelector": "string (for SSR)",
  "requiresClick": boolean,
  "diagnosis_ko": "string",
  "urlParams": [ { "targetParam": "goodsId", "domSelector": "string", "domAttribute": "string" } ],
  "staticBodyParams": { "string": "string" }
}
Return ONLY valid JSON. If impossible, { "error": "Cannot find mapping" }.`;

        const config = getApiConfig(result.apiKey);
        const aiRes = await fetch(config.url, {
          method: 'POST',
          headers: config.headers,
          body: JSON.stringify({
             contents: [{ role: 'user', parts: [{ text: prompt }] }],
             generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if (aiRes.status === 429) {
           throw new Error("Gemini API 할당량 초과! 무료 티어 제한으로 인해 약 1분 후 다시 시도해 주세요.");
        }
        if (!aiRes.ok) {
           throw new Error(`Gemini API Error: ${aiRes.status} ${aiRes.statusText}`);
        }

        const aiData = await aiRes.json();
        let ruleText = aiData.candidates[0].content.parts[0].text;
        
        // Robust JSON extraction (removes ```json ... ``` markers)
        const jsonMatch = ruleText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            ruleText = jsonMatch[0];
        }

        const ruleJson = JSON.parse(ruleText);
        
        if (ruleJson.error) throw new Error(ruleJson.error);

        // DO NOT SAVE YET. Send to content script for user confirmation.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0 && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'sniffing_rule_saved', ruleJson }).catch(() => {});
            }
        });

      } catch (err: any) {
        console.error(err);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0 && tabs[0].id) {
               chrome.tabs.sendMessage(tabs[0].id, { action: 'sniffing_rule_error', message: err.message });
            }
        });
      }
    });
    sendResponse({ status: 'Analyzing API rule in background' });
  } else if (request.action === 'analyze_option_states') {
    sendResponse({ status: 'Analyzing option states in background' });
    chrome.storage.sync.get(['apiKey'], async (result) => {
      try {
        if (!result.apiKey) throw new Error('API Key missing. Please config in popup.');

        const entries = request.optionEntries || [];
        const entrySummary = entries.map((e: any, i: number) => {
          const labels = Object.entries(e.labels || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
          return `--- 조합 ${i + 1} [${e.renderingType}] ---\n옵션: ${labels}\nURL: ${e.afterUrl || 'N/A'}\n스펙:\n${(e.specData || '(없음)').slice(0, 600)}`;
        }).join('\n\n');

        // NOTE: pythonCode as a string inside JSON breaks parsing when code contains
        // quotes, backslashes, or unescaped newlines. Use pythonCodeLines (array) instead.
        const prompt = `당신은 웹 크롤링 자동화 전문가입니다.

이 페이지의 옵션 버튼들을 모두 찾아내고, 각각을 클릭했을 때 스펙이 어떻게 변하는지 분석하는 코드를 짜줘.

아래는 상품 상세 페이지(${request.pageUrl || ''})에서 각 옵션 조합을 클릭하며 수집한 데이터입니다.

[수집된 옵션별 스펙 데이터]
${entrySummary}

분석 및 생성 요청:
1. URL에서 SKU를 식별하는 파라미터 패턴 (예: ?goodsId=XXX, /p/SKU). 없으면 "SSR 방식".
2. 옵션명 → SKU → 주요 스펙 차이점 매핑 테이블 (JSON 배열).
3. 모든 옵션 조합의 스펙을 자동 수집하는 Python 스크립트.
   - CSR: API 직접 호출 (requests 라이브러리)
   - SSR: Playwright 클릭 후 DOM 파싱

IMPORTANT: Return ONLY valid JSON. For pythonCode, use pythonCodeLines array (one string per line).
Do NOT embed raw code in a single string - it breaks JSON parsing.
Schema:
{
  "skuPattern": "string",
  "mappingTable": [ { "labels": {}, "sku": "string", "keySpecs": {} } ],
  "pythonCodeLines": ["line1", "line2", "..."]
}`;

        const config = getApiConfig(result.apiKey);
        // Use text response to avoid Gemini wrapping code in JSON string which breaks parsing
        const aiRes = await fetch(config.url, {
          method: 'POST',
          headers: config.headers,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 8192 }
          })
        });

        if (aiRes.status === 429) throw new Error('Gemini API 할당량 초과! 잠시 후 다시 시도해 주세요.');
        if (!aiRes.ok) throw new Error(`Gemini API Error: ${aiRes.status} ${aiRes.statusText}`);

        const aiData = await aiRes.json();
        let rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

        // Robust JSON extraction: find outermost { ... }
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');

        let parsed: any;
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Fallback: try to extract fields manually
          const skuMatch = rawText.match(/"skuPattern"\s*:\s*"([^"]+)"/);
          const linesMatch = rawText.match(/"pythonCodeLines"\s*:\s*\[([\s\S]*?)\]/);
          parsed = {
            skuPattern: skuMatch?.[1] || '패턴 추출 실패',
            mappingTable: [],
            pythonCodeLines: linesMatch
              ? linesMatch[1].split('\n').map((l: string) => l.replace(/^[\s,"]+|[\s,"]+$/g, ''))
              : ['# AI 코드 생성 실패 - 원본 응답을 확인하세요'],
            rawResponse: rawText.slice(0, 2000)
          };
        }

        // Convert pythonCodeLines array → pythonCode string for display
        if (Array.isArray(parsed.pythonCodeLines)) {
          parsed.pythonCode = parsed.pythonCodeLines.join('\n');
        }

        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'option_analysis_complete', result: parsed }).catch(() => {});
          }
        });
      } catch (err: any) {
        console.error(err);
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'option_analysis_error', message: err.message }).catch(() => {});
          }
        });
      }
    });
  }

  return true;
});

// Sniffer function to be injected into the MAIN world
function mainWorldSniffer() {
  if ((window as any).__WEB_SCRAPER_SNIFFER_ACTIVE) return;
  (window as any).__WEB_SCRAPER_SNIFFER_ACTIVE = true;

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
    }
    
    const requestId = Math.random().toString(36).substring(2, 10);
    
    // Stage 1: Request Start (Immediate)
    window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
      detail: { requestId, stage: 'start', type: 'fetch', url: url, method: method, body: body }
    }));

    const response = await originalFetch.apply(this, args);
    
    // Stage 2: Request Complete (After Response)
    try {
      const clonedResponse = response.clone();
      const bodyText = await clonedResponse.text();
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { requestId, stage: 'complete', type: 'fetch', url: url, method: method, body: body, response: bodyText }
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { requestId, stage: 'complete', type: 'fetch', url: url, method: method, body: body, response: '(Cannot read body)' }
      }));
    }
    
    return response;
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    (this as any)._method = method; 
    (this as any)._url = url;
    (this as any)._requestId = Math.random().toString(36).substring(2, 10);
    return originalXhrOpen.apply(this, [method, url, ...args] as any);
  };
  XMLHttpRequest.prototype.send = function(body: any) {
    let parsedBody = '';
    if (typeof body === 'string') { parsedBody = body; } 
    else if (body instanceof URLSearchParams) { parsedBody = body.toString(); }

    const requestId = (this as any)._requestId;

    // Stage 1: Request Start (Immediate)
    window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
      detail: { requestId, stage: 'start', type: 'xhr', url: (this as any)._url, method: (this as any)._method, body: parsedBody }
    }));

    // Stage 2: Request Complete (After Response)
    this.addEventListener('load', function() {
      let responseBody = '';
      try {
        if (!this.responseType || this.responseType === 'text') {
          responseBody = this.responseText;
        } else if (this.responseType === 'json') {
          responseBody = JSON.stringify(this.response);
        } else if (this.responseType === 'document') {
          responseBody = this.response.documentElement.outerHTML;
        } else {
          responseBody = '[Non-textual data: ' + this.responseType + ']';
        }
      } catch (e) {
        responseBody = '[Err reading response]';
      }

      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { requestId, stage: 'complete', type: 'xhr', url: (this as any)._url, method: (this as any)._method, body: parsedBody, response: responseBody }
      }));
    });

    return originalXhrSend.apply(this, [body]);
  };
  console.log("🚀 [WEB SCRAPER] Network Sniffer Injection Success (Reliability V2)");
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: mainWorldSniffer,
      world: 'MAIN'
    }).catch(() => {}); // Ignore errors on protected pages
  }
});
