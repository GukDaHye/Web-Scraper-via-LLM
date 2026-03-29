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

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
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
  }
  return true;
});
