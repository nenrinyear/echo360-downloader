function pageKind() {
  if (location.pathname.startsWith("/lesson/")) return "lesson";
  if (/^\/section\/[^/]+(?:\/home)?\/?$/.test(location.pathname)) return "section";
  return null;
}

function cleanTitle(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function sectionListRoot() {
  const explicit = document.evaluate(
    "/html/body/div[9]/div[3]/div/div/div/div[3]/div",
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
  return explicit instanceof Element ? explicit : document;
}

function collectSectionLessons() {
  const root = sectionListRoot();
  const entries = [];
  const seen = new Set();
  const candidates = new Set();
  for (const scope of root === document ? [document] : [root, document]) {
    for (const element of scope.querySelectorAll("a[href], [data-href], [data-url], [data-lesson-url], [data-lesson-id], [data-test-lessonid]")) {
      if (candidates.size >= 2000) break;
      candidates.add(element);
    }
  }
  for (const element of candidates) {
    const lessonId = element.getAttribute("data-test-lessonid")
      ?? element.getAttribute("data-lesson-id");
    const idUrl = /^[a-z0-9._:-]{1,500}$/i.test(lessonId ?? "")
      ? `/lesson/${lessonId}/classroom`
      : null;
    const rawUrl = element.getAttribute("href")
      ?? element.getAttribute("data-href")
      ?? element.getAttribute("data-url")
      ?? element.getAttribute("data-lesson-url")
      ?? idUrl;
    if (!rawUrl) continue;
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      continue;
    }
    if (url.origin !== location.origin || !url.pathname.startsWith("/lesson/")) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const row = element.closest("[role='row'], article, li, tr, [class*='card'], [class*='row']");
    const heading = element.matches("[role='heading'], .title")
      ? element
      : element.querySelector("[role='heading'], .title");
    entries.push({
      url: url.href,
      title: cleanTitle(
        heading?.getAttribute("aria-label")
        ?? heading?.textContent
        ?? element.getAttribute("aria-label")
        ?? element.getAttribute("title")
        ?? row?.textContent
        ?? element.textContent
        ?? "Echo360 lecture"
      )
    });
  }
  return entries;
}

async function sendRuntimeMessage(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Reloading the extension can invalidate scripts still running in open tabs.
    // sendMessage may throw synchronously as well as reject its promise.
  }
}

function sendPageInfo(lessons = null) {
  const kind = pageKind();
  if (!kind || window !== window.top) return;
  return sendRuntimeMessage({
    type: "PAGE_INFO",
    kind,
    title: document.title,
    pageUrl: location.href,
    lessons: kind === "section" ? lessons ?? collectSectionLessons() : undefined
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function collectAllSectionLessons() {
  const root = sectionListRoot();
  const localScrollers = root === document
    ? []
    : [root, ...root.querySelectorAll("div, section, main")];
  const scroller = localScrollers
    .filter((element) => {
      if (!element || element.scrollHeight <= element.clientHeight + 100) return false;
      return /^(auto|scroll)$/.test(getComputedStyle(element).overflowY);
    })
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0]
    ?? document.scrollingElement;
  const collected = new Map();
  const addVisible = () => {
    for (const lesson of collectSectionLessons()) collected.set(lesson.url, lesson);
  };
  addVisible();
  if (!scroller) {
    await sendPageInfo([...collected.values()]);
    return collected.size;
  }

  const originalTop = scroller.scrollTop;
  let stableBottomPasses = 0;
  for (let pass = 0; pass < 120 && stableBottomPasses < 2; pass += 1) {
    const previousHeight = scroller.scrollHeight;
    const nextTop = Math.min(
      scroller.scrollTop + Math.max(Math.floor(scroller.clientHeight * 0.8), 400),
      scroller.scrollHeight
    );
    scroller.scrollTop = nextTop;
    await delay(120);
    addVisible();
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    stableBottomPasses = atBottom && previousHeight === scroller.scrollHeight
      ? stableBottomPasses + 1
      : 0;
  }
  scroller.scrollTop = originalTop;
  await sendPageInfo([...collected.values()]);
  return collected.size;
}

sendPageInfo();

addEventListener("pagehide", () => {
  void sendRuntimeMessage({ type: "PAGE_UNLOAD" });
}, { once: true });

const titleElement = document.querySelector("title");
if (titleElement) {
  new MutationObserver(() => sendPageInfo()).observe(titleElement, {
    childList: true,
    subtree: true
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_SECTION_LESSONS" || pageKind() !== "section") return;
  collectAllSectionLessons().then(
    (count) => sendResponse({ ok: true, count }),
    (error) => sendResponse({ ok: false, error: error.message })
  );
  return true;
});

let sectionUpdateTimer = null;
if (pageKind() === "section" && window === window.top) {
  new MutationObserver(() => {
    clearTimeout(sectionUpdateTimer);
    sectionUpdateTimer = setTimeout(sendPageInfo, 350);
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "data-href", "data-url", "data-lesson-url", "data-lesson-id", "data-test-lessonid"]
  });
}
