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

    if (args[1] && args[1].body) {
      if (typeof args[1].body === 'string') { body = args[1].body; } 
      else if (args[1].body instanceof URLSearchParams) { body = args[1].body.toString(); }
      else if (args[1].body instanceof FormData) { /* simplified */ }
    }
    
    const response = await originalFetch.apply(this, args);
    
    // Capture response body for the sniffer
    try {
      const clonedResponse = response.clone();
      const bodyText = await clonedResponse.text();
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { type: 'fetch', url, method, body, response: bodyText }
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { type: 'fetch', url, method, body }
      }));
    }
    
    return response;
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    (this as any)._method = method; 
    (this as any)._url = url;
    return originalXhrOpen.apply(this, [method, url, ...args] as any);
  };
  XMLHttpRequest.prototype.send = function(body: any) {
    let parsedBody = '';
    if (typeof body === 'string') { parsedBody = body; } 
    else if (body instanceof URLSearchParams) { parsedBody = body.toString(); }

    this.addEventListener('load', function() {
      window.dispatchEvent(new CustomEvent('__WEB_SCRAPER_NETWORK_HOOK', {
        detail: { 
          type: 'xhr', 
          url: (this as any)._url, 
          method: (this as any)._method, 
          body: parsedBody, 
          response: (this as any).responseText 
        }
      }));
    });

    return originalXhrSend.apply(this, [body]);
  };
})();
