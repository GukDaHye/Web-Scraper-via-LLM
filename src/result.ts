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
        const val = row[k] ? String(row[k]).replace(/"/g, '""') : '';
        return `"${val}"`;
      });
      csvRows.push(values.join(','));
    }
    
    downloadFile(csvRows.join('\n'), 'scraped_data.csv', 'text/csv;charset=utf-8;');
  });
});
