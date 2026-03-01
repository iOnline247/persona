// Background service worker for Persona extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Persona extension installed');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_TAB_HOSTNAME') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (url) {
        try {
          const hostname = new URL(url).hostname;
          sendResponse({ hostname });
        } catch {
          sendResponse({ hostname: null });
        }
      } else {
        sendResponse({ hostname: null });
      }
    });
    return true;
  }
});
