// Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('Web Scraper Extension Installed');
});

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
      Please extract the core data points (like title, model, price, specific specs, description, etc.) from each item.
      Return the result strictly as a valid JSON array of objects.
      
      Here is the data:
      ${combinedMarkdown}
    `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    chrome.storage.sync.get(['apiKey'], async (result) => {
      try {
        if (!result.apiKey) throw new Error('API Key missing. Please config in popup.');
        
        const payloadStr = JSON.stringify(request.requestPayload, null, 2);
        const prompt = `You are an intelligent API reverse-engineering AI. I intercepted a network request fired when the user clicked a "Product Specs" button within a product card HTML.
Your job is to find which parameter in the API Request uniquely identifies this product, and find exactly where that parameter value exists in the PRODUCT CARD HTML.

--- API REQUEST ---
${payloadStr}

--- PRODUCT CARD HTML ---
${request.cardHtml}

Return a STRICT JSON object in this exact schema, identifying the variable mapping:
{
  "apiUrl": "Base API URL without dynamic variable (e.g., https://.../getSpec)",
  "apiMethod": "GET or POST",
  "urlParams": [
    {
      "type": "body or query",
      "targetParam": "the exact key name in the API (e.g., goodsId or productId)",
      "domSelector": "CSS selector to find this value in the HTML (e.g., [data-goods-id] or input.checkbox)",
      "domAttribute": "Name of the HTML attribute containing the value (e.g., data-goods-id, value, id). Use 'textContent' if it is inside the tag."
    }
  ],
  "staticBodyParams": {
     "key": "Any static value that should always be sent (excluding the dynamic targetParam above)"
  }
}
Return ONLY valid JSON. If it's impossible to map, return { "error": "Cannot find mapping" }.`;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${result.apiKey}`;
        const aiRes = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
             contents: [{ role: 'user', parts: [{ text: prompt }] }],
             generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if (!aiRes.ok) throw new Error(`AI API Error: ${aiRes.statusText}`);
        
        const aiData = await aiRes.json();
        const ruleText = aiData.candidates[0].content.parts[0].text;
        const ruleJson = JSON.parse(ruleText);
        
        if (ruleJson.error) throw new Error(ruleJson.error);

        chrome.storage.sync.set({ apiExtractionRule: JSON.stringify(ruleJson) }, () => {
             chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0 && tabs[0].id) {
                   chrome.tabs.sendMessage(tabs[0].id, { action: 'sniffing_rule_saved', ruleJson });
                }
             });
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
  }

  return true;
});
