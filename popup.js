import { formatBytes, qualityLabel } from "./media-model.js";

const empty = document.querySelector("#empty");
const content = document.querySelector("#content");
const qualities = document.querySelector("#qualities");
const subtitle = document.querySelector("#subtitle");
const status = document.querySelector("#status");

function trackName(track) {
  return track.trackType === "audio" ? "音声" : `Source ${track.source} 映像`;
}

async function download(tabId, trackKey, button) {
  button.disabled = true;
  status.textContent = "ダウンロードを開始しています…";
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_TRACK",
    tabId,
    trackKey,
    saveAs: false
  });
  button.disabled = false;
  status.textContent = response.ok
    ? "Chromeのダウンロード一覧に追加しました。"
    : `開始できませんでした: ${response.error}`;
}

function render(session) {
  const entries = Object.entries(session?.tracks ?? {});
  if (!entries.length) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    subtitle.textContent = "メディア未検出";
    return;
  }

  empty.classList.add("hidden");
  content.classList.remove("hidden");
  subtitle.textContent = session.title;
  qualities.replaceChildren();

  const grouped = new Map();
  for (const entry of entries) {
    const quality = entry[1].quality;
    grouped.set(quality, [...(grouped.get(quality) ?? []), entry]);
  }
  for (const [quality, tracks] of [...grouped].sort(([a], [b]) => b - a)) {
    const card = document.createElement("article");
    card.className = "quality-card";
    const total = tracks.reduce((sum, [, track]) => sum + (track.size || 0), 0);
    card.innerHTML = `
      <div class="quality-head">
        <h2>${qualityLabel(quality)}</h2>
        <span>3トラック合計 ${formatBytes(total)}</span>
      </div>
    `;

    for (const [trackKey, track] of tracks.sort(([, a], [, b]) => a.source - b.source)) {
      const row = document.createElement("div");
      row.className = "track-row";
      const info = document.createElement("div");
      info.innerHTML = `<strong>${trackName(track)}</strong><small>${formatBytes(track.size)}</small>`;
      const button = document.createElement("button");
      button.textContent = "保存";
      button.addEventListener("click", () => download(session.tabId, trackKey, button));
      row.append(info, button);
      card.append(row);
    }
    qualities.append(card);
  }
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (!tab?.id || !tab.url?.startsWith("https://echo360.net.au/lesson/")) {
  subtitle.textContent = "Echo360の授業タブで開いてください";
  empty.classList.remove("hidden");
} else {
  const response = await chrome.runtime.sendMessage({ type: "GET_SESSION", tabId: tab.id });
  render(response.session);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SESSION_UPDATED" && message.tabId === tab?.id) {
    chrome.runtime.sendMessage({ type: "GET_SESSION", tabId: tab.id })
      .then((response) => render(response.session));
  }
});
