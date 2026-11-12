import { formatBytes, qualityLabel } from "./media-model.js";

const empty = document.querySelector("#empty");
const content = document.querySelector("#content");
const qualities = document.querySelector("#qualities");
const subtitle = document.querySelector("#subtitle");
const status = document.querySelector("#status");
const sectionContent = document.querySelector("#section-content");
const sectionSummary = document.querySelector("#section-summary");
const sectionDownload = document.querySelector("#section-download");
const batchProgress = document.querySelector("#batch-progress");
const batchCancel = document.querySelector("#batch-cancel");
const progressBar = document.querySelector("#progress-bar");
const progressText = document.querySelector("#progress-text");
const customFolder = document.querySelector("#custom-folder");
const saveDownloadSettings = document.querySelector("#save-download-settings");
const effectiveFolder = document.querySelector("#effective-folder");
const folderDialog = document.querySelector("#folder-dialog");
const folderForm = document.querySelector("#folder-form");
const confirmedFolder = document.querySelector("#confirmed-folder");
const folderError = document.querySelector("#folder-error");
const folderStart = document.querySelector("#folder-start");
const folderCancel = document.querySelector("#folder-cancel");

function renderDownloadSettings(settings) {
  customFolder.value = settings.effectiveFolder;
  effectiveFolder.textContent = `Chromeの保存先 / ${settings.effectiveFolder}`;
}

async function saveFolder(folder) {
  const response = await chrome.runtime.sendMessage({
    type: "SET_DOWNLOAD_SETTINGS",
    settings: { useCustomFolder: true, customFolder: folder }
  });
  if (!response.ok) {
    status.textContent = `保存先を変更できませんでした: ${response.error}`;
    return null;
  }
  renderDownloadSettings(response.settings);
  return response.settings;
}

async function confirmDownloadFolder() {
  const response = await chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_SETTINGS" });
  if (!response.ok) {
    status.textContent = `保存先を取得できませんでした: ${response.error}`;
    return null;
  }
  confirmedFolder.value = customFolder.value || response.settings.effectiveFolder;
  folderError.textContent = "";
  folderStart.disabled = false;
  return new Promise((resolve) => {
    const finish = (settings) => {
      folderForm.removeEventListener("submit", submit);
      folderDialog.removeEventListener("cancel", cancel);
      folderCancel.removeEventListener("click", cancel);
      folderDialog.close();
      resolve(settings);
    };
    const cancel = (event) => {
      event.preventDefault();
      if (folderCancel.disabled) return;
      status.textContent = "ダウンロードをキャンセルしました。";
      finish(null);
    };
    const submit = async (event) => {
      event.preventDefault();
      folderStart.disabled = true;
      folderCancel.disabled = true;
      try {
        const settings = await saveFolder(confirmedFolder.value);
        if (settings) finish(settings);
        else folderError.textContent = status.textContent;
      } catch (error) {
        folderError.textContent = `保存先を設定できませんでした: ${error.message}`;
      } finally {
        folderStart.disabled = false;
        folderCancel.disabled = false;
      }
    };
    folderForm.addEventListener("submit", submit);
    folderDialog.addEventListener("cancel", cancel);
    folderCancel.addEventListener("click", cancel);
    folderDialog.showModal();
    confirmedFolder.focus();
    confirmedFolder.select();
  });
}

function trackName(track) {
  return track.trackType === "audio" ? "音声" : `Source ${track.source} 映像`;
}

async function download(tabId, trackKey, button) {
  button.disabled = true;
  const settings = await confirmDownloadFolder();
  if (!settings) {
    button.disabled = false;
    return;
  }
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

async function downloadBundle(tabId, quality, button) {
  button.disabled = true;
  const settings = await confirmDownloadFolder();
  if (!settings) {
    button.disabled = false;
    return;
  }
  status.textContent = "検出済みトラックとメタデータを保存しています…";
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_BUNDLE",
    tabId,
    quality
  });
  button.disabled = false;
  status.textContent = response.ok
    ? `${response.folder} に一括保存を開始しました。完了後に echo360-merge を実行してください。`
    : `開始できませんでした: ${response.error}`;
}

function renderLesson(session) {
  sectionContent.classList.add("hidden");
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
        <span>${tracks.length}トラック合計 ${formatBytes(total)}</span>
      </div>
    `;

    const sources = new Set(tracks.map(([, track]) => track.source));
    const canBundle = sources.has(0) && (sources.has(1) || sources.has(2));
    const bundleButton = document.createElement("button");
    bundleButton.className = "bundle-button";
    bundleButton.textContent = canBundle ? `${tracks.length}トラックを一括保存` : "音声・映像の検出待ち";
    bundleButton.disabled = !canBundle;
    if (canBundle) {
      bundleButton.addEventListener("click", () => downloadBundle(session.tabId, quality, bundleButton));
    }
    card.append(bundleButton);

    for (const [trackKey, track] of tracks.sort(([, a], [, b]) => a.source - b.source)) {
      const row = document.createElement("div");
      row.className = "track-row";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = trackName(track);
      const size = document.createElement("small");
      size.textContent = formatBytes(track.size);
      info.append(name, size);
      const button = document.createElement("button");
      button.textContent = "保存";
      button.addEventListener("click", () => download(session.tabId, trackKey, button));
      row.append(info, button);
      card.append(row);
    }
    qualities.append(card);
  }
}

function renderSection(session) {
  const count = session.lessons?.length ?? 0;
  empty.classList.add("hidden");
  content.classList.add("hidden");
  sectionContent.classList.remove("hidden");
  subtitle.textContent = session.title;
  sectionSummary.textContent = count
    ? `${count}件の授業を検出しました。各授業で利用可能な最高品質のトラックを順番に保存します。`
    : "授業リンクを検出できません。ページの一覧が表示されるまで待ってください。";
  sectionDownload.disabled = count === 0;
}

function render(session) {
  if (session?.kind === "section") renderSection(session);
  else renderLesson(session);
}

function renderBatch(batch) {
  if (!batch) {
    batchProgress.classList.add("hidden");
    return;
  }
  const done = batch.completed + batch.failed;
  const percent = batch.total ? Math.round((done / batch.total) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  batchProgress.classList.toggle("hidden", batch.status !== "running" && done === 0);
  batchCancel.classList.toggle("hidden", batch.status !== "running");
  sectionDownload.disabled = batch.status === "running";
  if (batch.status === "running") {
    progressText.textContent = `${done}/${batch.total}件完了（失敗 ${batch.failed}件） ${batch.currentTitle || ""} ${batch.currentStage || ""}`;
  } else if (batch.status === "completed") {
    progressText.textContent = `${batch.total}件の処理が完了しました（成功 ${batch.completed}件、失敗 ${batch.failed}件）。`;
  } else if (batch.status === "cancelled") {
    progressText.textContent = `一括処理を中止しました（成功 ${batch.completed}件、失敗 ${batch.failed}件）。`;
  }
  if (batch.lastError) status.textContent = `直近のエラー: ${batch.lastError}`;
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

saveDownloadSettings.addEventListener("click", async () => {
  saveDownloadSettings.disabled = true;
  const settings = await saveFolder(customFolder.value);
  saveDownloadSettings.disabled = false;
  if (settings) status.textContent = `デフォルト保存先を Chromeの保存先 / ${settings.effectiveFolder} に設定しました。`;
});

const settingsResponse = await chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_SETTINGS" });
if (settingsResponse.ok) renderDownloadSettings(settingsResponse.settings);

sectionDownload.addEventListener("click", async () => {
  sectionDownload.disabled = true;
  const settings = await confirmDownloadFolder();
  if (!settings) {
    sectionDownload.disabled = false;
    return;
  }
  status.textContent = "一括ダウンロードを開始しています…";
  const response = await chrome.runtime.sendMessage({
    type: "START_SECTION_BATCH",
    tabId: tab.id
  });
  status.textContent = response.ok
    ? "授業を順番に開いてダウンロードします。このsectionタブは開いたままにしてください。"
    : `開始できませんでした: ${response.error}`;
  if (response.batch) renderBatch(response.batch);
  if (!response.ok) sectionDownload.disabled = false;
});

batchCancel.addEventListener("click", async () => {
  batchCancel.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "CANCEL_SECTION_BATCH" });
  renderBatch(response.batch);
  batchCancel.disabled = false;
  status.textContent = "一括処理を中止しました。開始済みのダウンロードはChrome側で継続します。";
});

const supportedPage = tab?.url?.startsWith("https://echo360.net.au/lesson/")
  || tab?.url?.startsWith("https://echo360.net.au/section/");
if (!tab?.id || !supportedPage) {
  subtitle.textContent = "Echo360の授業またはsectionタブで開いてください";
  empty.classList.remove("hidden");
} else {
  const response = await chrome.runtime.sendMessage({ type: "GET_SESSION", tabId: tab.id });
  render(response.session);
  const batchResponse = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  renderBatch(batchResponse.batch);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SESSION_UPDATED" && message.tabId === tab?.id) {
    chrome.runtime.sendMessage({ type: "GET_SESSION", tabId: tab.id })
      .then((response) => render(response.session));
  }
  if (message?.type === "BATCH_UPDATED") renderBatch(message.batch);
});
