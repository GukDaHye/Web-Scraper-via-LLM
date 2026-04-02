// Script for displaying and downloading extraction results

document.addEventListener('DOMContentLoaded', () => {
  const outputView = document.getElementById('outputView') as HTMLPreElement;
  const loadingMsg = document.getElementById('loadingMsg') as HTMLDivElement;
  const downloadJsonBtn = document.getElementById('downloadJsonBtn') as HTMLButtonElement;
  const downloadCsvBtn = document.getElementById('downloadCsvBtn') as HTMLButtonElement;
  
  let currentData: any[] = [];

  chrome.storage.local.get(['extractionResult'], (result) => {
    loadingMsg.style.display = 'none';
    outputView.style.display = 'block';

    if (result.extractionResult) {
      currentData = result.extractionResult;
      outputView.textContent = JSON.stringify(currentData, null, 2);
    } else {
      outputView.textContent = 'No extraction data found.';
    }
  });

  const downloadFile = (data: string, filename: string, type: string) => {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  downloadJsonBtn.addEventListener('click', () => {
    if (currentData.length === 0) return alert('No data to download');
    downloadFile(JSON.stringify(currentData, null, 2), 'scraped_data.json', 'application/json');
  });

  downloadCsvBtn.addEventListener('click', () => {
    if (currentData.length === 0) return alert('No data to download');
    
    // Simple JSON to CSV converter (assumes flat objects)
    const header = Object.keys(currentData[0]);
    const csvRows = [header.join(',')];
    
    for (const row of currentData) {
      const values = header.map(k => {
        const val = row[k] ? String(row[k]) : '';
        const escaped = val.replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(','));
    }
    
    downloadFile(csvRows.join('\n'), 'scraped_data.csv', 'text/csv;charset=utf-8;');
  });

  const generatePythonBtn = document.getElementById('generatePythonBtn') as HTMLButtonElement;
  generatePythonBtn.addEventListener('click', async () => {
    // 💡 Try sync storage first, fallback to local
    let context = await new Promise<any>(res => chrome.storage.sync.get(['lastScrapedUrl', 'listSelector', 'detailSelector', 'apiExtractionRule'], res));
    if (!context.lastScrapedUrl) {
      context = await new Promise<any>(res => chrome.storage.local.get(['lastScrapedUrl', 'listSelector', 'detailSelector', 'apiExtractionRule'], res));
    }
    
    const { lastScrapedUrl, listSelector, detailSelector, apiExtractionRule } = context;
    
    if (!lastScrapedUrl || !listSelector) {
        return alert('⚠️ No scraping rule context found.\n\n해결 방법: 추출 대상 페이지에서 [Extract Current Page]를 다시 한 번 실행해 주세요. 추출이 시작될 때 규칙 정보가 자동으로 저장됩니다.');
    }

    let rule: any = {};
    try { rule = JSON.parse(apiExtractionRule || '{}'); } catch(e) {}

    const isSSR = rule.renderingType === 'SSR';
    const isCSR = rule.renderingType === 'CSR';

    const pythonScript = `
import asyncio
import json
import requests
from playwright.async_api import async_playwright

# [WEB SCRAPER] Generated Python Script (Playwright)
# Target: ${lastScrapedUrl}

async def scrape():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()
        print("🚀 Navigating to ${lastScrapedUrl}...")
        await page.goto("${lastScrapedUrl}", wait_until="networkidle")
        
        # 1. Find List Items
        items = await page.query_selector_all("${listSelector}")
        print(f"📦 Found {len(items)} items.")
        
        results = []
        for i, item in enumerate(items):
            print(f"🔍 Processing item {i+1}...")
            data = {"index": i+1}
            
            # --- Extraction Strategy ---
            if "samsung.com/sec" in "${lastScrapedUrl}":
                # [SAMSUNG KOREA SPECIALIZED RULE]
                id_els = await item.query_selector_all("[data-goods-id]")
                unique_ids = set()
                
                # If no children have IDs, check the item itself
                if not id_els:
                    gid = await item.get_attribute("data-goods-id")
                    if gid: 
                        gnm = await item.get_attribute("data-goods-nm") or ""
                        gtp = await item.get_attribute("data-goods-tp-cd") or "10"
                        unique_ids.add((gid, gnm, gtp))
                else:
                    for el in id_els:
                        gid = await el.get_attribute("data-goods-id")
                        if gid:
                            gnm = await el.get_attribute("data-goods-nm") or ""
                            gtp = await el.get_attribute("data-goods-tp-cd") or "10"
                            unique_ids.add((gid, gnm, gtp))
                
                data["specs"] = []
                for gid, gnm, gtp in unique_ids:
                    api_url = "https://www.samsung.com/sec/xhr/goods/getGoodsSpecList" if gnm else "https://www.samsung.com/sec/xhr/goods/goodsSpec"
                    payload = {"goodsId": gid, "goodsTpCd": gtp, "adminYn": ""}
                    if gnm: payload["goodsNm"] = gnm
                    
                    print(f"📡 API Direct Fetch (Korea) for ID: {gid}...")
                    resp = requests.post(api_url, data=payload, headers={
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    })
                    if resp.status_code == 200:
                        data["specs"].append({"id": gid, "html": resp.text})

            elif ${isSSR}:
                # [SSR Strategy]
                target_area = await item.query_selector("${detailSelector || rule.specDomSelector || 'body'}")
                if target_area:
                    ${rule.requiresClick ? `
                    # Click to expand
                    expand_btn = await target_area.query_selector('button, .cta, [role="button"]')
                    if expand_btn:
                        await expand_btn.click()
                        await page.wait_for_timeout(1000)
                    ` : '# No click required'}
                    data["raw_content"] = await target_area.inner_text()

            elif ${isCSR}:
                # [CSR Strategy]
                # Extract ID from DOM
                ${rule.urlParams && rule.urlParams[0] ? `
                id_el = await item.query_selector("${rule.urlParams[0].domSelector}")
                if id_el:
                    goods_id = await id_el.get_attribute("${rule.urlParams[0].domAttribute}") if "${rule.urlParams[0].domAttribute}" != "textContent" else await id_el.inner_text()
                    # Fetch API
                    api_url = "${rule.apiUrl}"
                    payload = ${JSON.stringify(rule.staticBodyParams || {})}
                    payload["${rule.urlParams[0].targetParam}"] = goods_id
                    
                    print(f"📡 Deep-fetching API for ID: {goods_id}...")
                    resp = requests.post(api_url, data=payload, headers={'Content-Type': 'application/x-www-form-urlencoded'})
                    if resp.status_code == 200:
                        data["api_response"] = resp.text # Or resp.json() if it is JSON
                ` : '# No ID mapping found'}
            
            results.append(data)
            
        # Save results
        with open("scraped_results.json", "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Scraping complete. Saved to scraped_results.json")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(scrape())
`;
    downloadFile(pythonScript.trim(), 'scrape_script.py', 'text/x-python');
  });
});
