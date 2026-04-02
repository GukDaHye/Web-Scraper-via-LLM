// Popup script for the Chrome Extension
import './style.css';

document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const pickListBtn = document.getElementById('pickListBtn') as HTMLButtonElement;
  const pickLoadMoreBtn = document.getElementById('pickLoadMoreBtn') as HTMLButtonElement;
  const pickDetailBtn = document.getElementById('pickDetailBtn') as HTMLButtonElement;
  const pickApiSnifferBtn = document.getElementById('pickApiSnifferBtn') as HTMLButtonElement;
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
  const listSelectorInput = document.getElementById('listSelector') as HTMLInputElement;
  const loadMoreSelectorInput = document.getElementById('loadMoreSelector') as HTMLInputElement;
  const detailSelectorInput = document.getElementById('detailSelector') as HTMLInputElement;
  const apiSnifferInput = document.getElementById('apiSniffer') as HTMLInputElement;
  const statusMsg = document.getElementById('statusMessage') as HTMLParagraphElement;

  chrome.storage.sync.get(['apiKey', 'listSelector', 'loadMoreSelector', 'detailSelector', 'apiExtractionRule'], (result) => {
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (result.listSelector) listSelectorInput.value = result.listSelector;
    if (result.loadMoreSelector) loadMoreSelectorInput.value = result.loadMoreSelector;
    if (result.detailSelector) detailSelectorInput.value = result.detailSelector;
    if (result.apiExtractionRule) apiSnifferInput.value = 'Rule Saved ✅';
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      if (changes.listSelector) listSelectorInput.value = changes.listSelector.newValue;
      if (changes.loadMoreSelector) loadMoreSelectorInput.value = changes.loadMoreSelector.newValue;
      if (changes.detailSelector) detailSelectorInput.value = changes.detailSelector.newValue;
      if (changes.apiExtractionRule) apiSnifferInput.value = 'Rule Saved ✅';
    }
  });

  const sendPickMessage = async (target: 'listSelector' | 'loadMoreSelector' | 'detailSelector' | 'apiSniffer') => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      if (tab.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'start_picking', target });
        window.close(); // Close popup so user can pick
      }
    } catch (error) {
      statusMsg.textContent = 'Please refresh the page to use the picker.';
      statusMsg.style.color = 'red';
    }
  };

  pickListBtn.addEventListener('click', () => sendPickMessage('listSelector'));
  pickLoadMoreBtn.addEventListener('click', () => sendPickMessage('loadMoreSelector'));
  pickDetailBtn.addEventListener('click', () => sendPickMessage('detailSelector'));
  pickApiSnifferBtn.addEventListener('click', () => sendPickMessage('apiSniffer'));

  saveBtn.addEventListener('click', () => {
    const config = {
      apiKey: apiKeyInput.value,
      listSelector: listSelectorInput.value,
      loadMoreSelector: loadMoreSelectorInput.value,
      detailSelector: detailSelectorInput.value
    };
    
    chrome.storage.sync.set(config, () => {
      statusMsg.textContent = 'Configuration saved!';
      statusMsg.style.color = 'green';
      setTimeout(() => statusMsg.textContent = '', 2000);
    });
  });

  startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      if (tab.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'start_extraction' });
        statusMsg.textContent = 'Extraction started...';
        statusMsg.style.color = 'blue';
      }
    } catch (error) {
      statusMsg.textContent = 'Please refresh the page to use the extension.';
      statusMsg.style.color = 'red';
    }
  });

  // Option Scraper
  const openOptionScraperBtn = document.getElementById('openOptionScraperBtn') as HTMLButtonElement;
  openOptionScraperBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      if (tab.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'open_option_scraper' });
        window.close();
      }
    } catch {
      statusMsg.textContent = '페이지를 새로고침 후 다시 시도해 주세요.';
      statusMsg.style.color = 'red';
    }
  });
});
