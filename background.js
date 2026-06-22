// background.js — message relay between devtools and panel
//
// port.sender.tab.id is undefined for DevTools pages, so we can't use the
// sender to identify the tab. Instead, devtools.js includes its inspectedWindow
// tabId in every message and we use that for routing here.

const panels = {}; // tabId → port do panel

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'devtools') {
    port.onMessage.addListener((msg) => {
      const tabId = msg.tabId;
      if (tabId && panels[tabId]) {
        panels[tabId].postMessage(msg);
      }
    });
  }

  if (port.name === 'panel') {
    port.onMessage.addListener((msg) => {
      if (msg.type === 'PANEL_INIT') {
        panels[msg.tabId] = port;
        port.onDisconnect.addListener(() => {
          delete panels[msg.tabId];
        });
      }
    });
  }
});
