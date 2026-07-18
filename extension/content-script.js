function sendPageInfo() {
  chrome.runtime.sendMessage({
    type: "PAGE_INFO",
    title: document.title,
    pageUrl: location.href
  }).catch(() => {});
}

sendPageInfo();

addEventListener("pagehide", () => {
  chrome.runtime.sendMessage({ type: "PAGE_UNLOAD" }).catch(() => {});
}, { once: true });

const titleElement = document.querySelector("title");
if (titleElement) {
  new MutationObserver(sendPageInfo).observe(titleElement, {
    childList: true,
    subtree: true
  });
}
