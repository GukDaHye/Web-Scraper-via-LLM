// This script runs in the MAIN world to intercept network requests
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

    const requestId = Math.random().toString(36).substring(2, 10);
    
    // Stage 1: Request Start (Immediate)
    window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
      detail: { requestId, stage: 'start', type: 'fetch', url, method, body }
    }));

    const response = await originalFetch.apply(this, args);
    
    // Stage 2: Request Complete (After Response)
    try {
      const clonedResponse = response.clone();
      const bodyText = await clonedResponse.text();
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { requestId, stage: 'complete', type: 'fetch', url, method, body, response: bodyText }
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { requestId, stage: 'complete', type: 'fetch', url, method, body, response: '(Cannot read body: ' + e + ')' }
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
      detail: { 
        requestId, 
        stage: 'start',
        type: 'xhr', 
        url: (this as any)._url, 
        method: (this as any)._method, 
        body: parsedBody 
      }
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
        responseBody = '[Err reading response: ' + e + ']';
      }

      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { 
          requestId, 
          stage: 'complete',
          type: 'xhr', 
          url: (this as any)._url, 
          method: (this as any)._method, 
          body: parsedBody, 
          response: responseBody 
        }
      }));
    });

    return originalXhrSend.apply(this, [body]);
  };

  // ── URL Change Hooks (for SPA option tracking) ──
  const dispatchUrlChange = () => {
    window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_URL_CHANGE', {
      detail: { url: location.href }
    }));
  };

  const origPushState = history.pushState.bind(history);
  history.pushState = function(...args: Parameters<typeof history.pushState>) {
    origPushState(...args);
    dispatchUrlChange();
  };

  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
    origReplaceState(...args);
    dispatchUrlChange();
  };

  window.addEventListener('popstate', dispatchUrlChange);
  window.addEventListener('hashchange', dispatchUrlChange);
})();
