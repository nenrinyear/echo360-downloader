import {
  findDownloadableQualities,
  headersToObject,
  normalizeLessonEntries,
  parseContentRange,
  parseEchoPageUrl,
  parseMediaUrl,
  sanitizeFilename
} from "./media-model.js";

const sessions = new Map();
const storageKey = (tabId) => `session:${tabId}`;
const BATCH_STORAGE_KEY = "sectionBatch";
const BATCH_TIMEOUT_MINUTES = 1.5;
const batchDownloadTabs = new Set();
const batchSettleTimers = new Map();

chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

function isLessonUrl(value) {
  return parseEchoPageUrl(value)?.kind === "lesson";
}

function isSectionUrl(value) {
  return parseEchoPageUrl(value)?.kind === "section";
}

async function persistSession(session) {
  await chrome.storage.session.set({ [storageKey(session.tabId)]: session });
}

async function loadSession(tabId) {
  if (sessions.has(tabId)) return sessions.get(tabId);
  const stored = await chrome.storage.session.get(storageKey(tabId));
  const session = stored[storageKey(tabId)] ?? null;
  if (session) sessions.set(tabId, session);
  return session;
}

function getSession(tabId) {
  if (!sessions.has(tabId)) {
    sessions.set(tabId, {
      tabId,
      kind: "lesson",
      title: "Echo360 lecture",
      pageUrl: "",
      detectedAt: Date.now(),
      tracks: {}
    });
  }
  return sessions.get(tabId);
}

function publicSession(session) {
  if (!session) return null;
  return {
    tabId: session.tabId,
    kind: session.kind ?? "lesson",
    title: session.title,
    pageUrl: session.pageUrl,
    detectedAt: session.detectedAt,
    lessons: (session.lessons ?? []).map((lesson) => ({ title: lesson.title })),
    tracks: Object.fromEntries(
      Object.entries(session.tracks ?? {}).map(([key, track]) => [key, {
        file: track.file,
        source: track.source,
        quality: track.quality,
        trackType: track.trackType,
        size: track.size
      }])
    )
  };
}

function notify(tabId) {
  const session = getSession(tabId);
  const count = session.kind === "section"
    ? session.lessons?.length ?? 0
    : Object.keys(session.tracks ?? {}).length;
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#7c3aed" });
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
  chrome.runtime.sendMessage({ type: "SESSION_UPDATED", tabId }).catch(() => {});
}

function lectureDate(pageUrl) {
  return pageUrl.match(/_(\d{4}-\d{2}-\d{2})T/)?.[1] ?? "undated";
}

function bundleFolder(session, quality = null, unique = false) {
  const qualityPart = quality === null ? "" : `_q${quality}`;
  const uniquePart = unique
    ? `_${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`
    : "";
  return `${sanitizeFilename(session.title)}_${lectureDate(session.pageUrl)}${qualityPart}${uniquePart}`;
}

function trackFilename(track) {
  return track.trackType === "audio"
    ? `audio-q${track.quality}.mp4`
    : `source-${track.source}-q${track.quality}.mp4`;
}

async function startTrackDownload(session, track, folder, saveAs = false) {
  return chrome.downloads.download({
    url: track.url,
    filename: `Echo360/${folder}/${trackFilename(track)}`,
    saveAs,
    conflictAction: "uniquify"
  });
}

async function downloadMetadata(session, quality, tracks, folder) {
  const metadata = {
    schemaVersion: 1,
    title: session.title,
    lectureDate: lectureDate(session.pageUrl),
    quality,
    createdAt: new Date().toISOString(),
    tracks: tracks.map((track) => ({
      role: track.trackType === "audio" ? "audio" : `source-${track.source}`,
      filename: trackFilename(track),
      size: track.size
    })),
    outputs: {
      source1: "source-1-with-audio.mp4",
      source2: "source-2-with-audio.mp4",
      combined: "combined.mp4"
    }
  };
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(metadata, null, 2))}`;
  return chrome.downloads.download({
    url,
    filename: `Echo360/${folder}/echo360.json`,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

function publicBatchState(state) {
  if (!state) return null;
  return {
    id: state.id,
    status: state.status,
    total: state.entries.length,
    completed: state.completed,
    failed: state.failed,
    currentTitle: state.currentTitle,
    currentStage: state.currentStage,
    lastError: state.lastError,
    startedAt: state.startedAt
  };
}

async function loadBatchState() {
  const stored = await chrome.storage.session.get(BATCH_STORAGE_KEY);
  return stored[BATCH_STORAGE_KEY] ?? null;
}

async function persistBatchState(state) {
  await chrome.storage.session.set({ [BATCH_STORAGE_KEY]: state });
  chrome.runtime.sendMessage({
    type: "BATCH_UPDATED",
    batch: publicBatchState(state)
  }).catch(() => {});
}

function batchAlarmName(state) {
  return `echo360-batch:${state.id}:${state.currentTabId}`;
}

function schedulePartialBatchDownload(session) {
  clearTimeout(batchSettleTimers.get(session.tabId));
  batchSettleTimers.set(session.tabId, setTimeout(() => {
    batchSettleTimers.delete(session.tabId);
    maybeDownloadBatch(session, true).catch(() => {});
  }, 6000));
}

async function triggerBatchPlayback(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const marker = "__echo360BatchPlaybackTimer";
        if (globalThis[marker]) return;
        const tryPlayback = () => {
          for (const media of document.querySelectorAll("video, audio")) {
            media.muted = true;
            media.play().catch(() => {});
          }
          for (const button of document.querySelectorAll("button")) {
            const label = String(
              button.getAttribute("aria-label")
              ?? button.getAttribute("title")
              ?? button.textContent
              ?? ""
            ).replace(/\s+/g, " ").trim();
            if (/^(play|再生|start playback)$/i.test(label)) button.click();
          }
        };
        tryPlayback();
        globalThis[marker] = setInterval(tryPlayback, 2000);
        setTimeout(() => {
          clearInterval(globalThis[marker]);
          delete globalThis[marker];
        }, 60000);
      }
    });
  } catch {
    // The page may still be navigating; onUpdated/PAGE_INFO will retry.
  }
}

async function openCurrentBatchEntry(state) {
  if (state.status !== "running") return;
  if (state.index >= state.entries.length) {
    state.status = "completed";
    state.currentTitle = "";
    state.currentStage = "";
    state.finishedAt = Date.now();
    await persistBatchState(state);
    return;
  }

  const entry = state.entries[state.index];
  state.currentTitle = entry.title;
  state.currentStage = "ページを開いています";
  state.lastError = "";
  try {
    const tab = await chrome.tabs.create({ url: entry.url, active: false });
    state.currentTabId = tab.id;
    await persistBatchState(state);
    await chrome.alarms.create(batchAlarmName(state), { delayInMinutes: BATCH_TIMEOUT_MINUTES });
    await triggerBatchPlayback(tab.id);
  } catch (error) {
    await finishCurrentBatchEntry(state, false, error.message);
  }
}

async function finishCurrentBatchEntry(state, succeeded, error = "", folder = "") {
  if (state.status !== "running") return;
  const closingTabId = state.currentTabId;
  clearTimeout(batchSettleTimers.get(closingTabId));
  batchSettleTimers.delete(closingTabId);
  if (closingTabId != null) await chrome.alarms.clear(batchAlarmName(state));
  state.results.push({
    title: state.currentTitle,
    status: succeeded ? "completed" : "failed",
    error,
    folder
  });
  if (succeeded) state.completed += 1;
  else state.failed += 1;
  state.lastError = error;
  state.index += 1;
  state.currentTabId = null;
  state.currentTitle = "";
  state.currentStage = "";
  await persistBatchState(state);
  if (closingTabId != null) chrome.tabs.remove(closingTabId).catch(() => {});
  await openCurrentBatchEntry(state);
}

async function maybeDownloadBatch(session, allowSingleVideo = false) {
  if (batchDownloadTabs.has(session.tabId) || !isLessonUrl(session.pageUrl)) return;
  const state = await loadBatchState();
  if (
    !state ||
    state.status !== "running" ||
    state.currentTabId !== session.tabId ||
    state.currentStage === "ダウンロードを開始しています"
  ) return false;
  const quality = findDownloadableQualities(session.tracks, !allowSingleVideo)[0];
  if (quality == null) return false;

  batchDownloadTabs.add(session.tabId);
  try {
    state.currentStage = "ダウンロードを開始しています";
    await chrome.alarms.clear(batchAlarmName(state));
    await persistBatchState(state);
    const tracks = [0, 1, 2]
      .map((source) => session.tracks[`${source}:${quality}`])
      .filter(Boolean);
    const folder = bundleFolder(session, quality, true);
    await Promise.all([
      ...tracks.map((track) => startTrackDownload(session, track, folder)),
      downloadMetadata(session, quality, tracks, folder)
    ]);
    await finishCurrentBatchEntry(state, true, "", `Echo360/${folder}`);
  } catch (error) {
    await finishCurrentBatchEntry(state, false, error.message);
  } finally {
    batchDownloadTabs.delete(session.tabId);
  }
  return true;
}

async function startSectionBatch(session) {
  const existing = await loadBatchState();
  if (existing?.status === "running") {
    throw new Error("別の一括ダウンロードが実行中です。");
  }
  if (!session.lessons?.length) {
    throw new Error("授業リンクが見つかりません。一覧が表示されるまで待ってから再試行してください。");
  }
  const state = {
    id: `${Date.now()}-${session.tabId}`,
    status: "running",
    sectionTabId: session.tabId,
    sectionTitle: session.title,
    entries: session.lessons,
    index: 0,
    completed: 0,
    failed: 0,
    currentTabId: null,
    currentTitle: "",
    currentStage: "",
    lastError: "",
    results: [],
    startedAt: Date.now()
  };
  await persistBatchState(state);
  await openCurrentBatchEntry(state);
  return state;
}

async function cancelSectionBatch() {
  const state = await loadBatchState();
  if (!state || state.status !== "running") return state;
  const closingTabId = state.currentTabId;
  if (closingTabId != null) await chrome.alarms.clear(batchAlarmName(state));
  state.status = "cancelled";
  state.currentTabId = null;
  state.currentStage = "";
  state.finishedAt = Date.now();
  await persistBatchState(state);
  if (closingTabId != null) chrome.tabs.remove(closingTabId).catch(() => {});
  return state;
}

async function handleMediaResponse(details) {
  if (details.tabId < 0) return;
  if (details.initiator !== "https://echo360.net.au") return;
  const media = parseMediaUrl(details.url);
  if (!media || media.kind !== "media") return;

  const headers = headersToObject(details.responseHeaders);
  const range = parseContentRange(headers["content-range"]);
  const size = range?.total ?? (Number(headers["content-length"]) || null);
  const session = await loadSession(details.tabId) ?? getSession(details.tabId);
  const key = `${media.source}:${media.quality}`;
  const previous = session.tracks[key];

  session.tracks[key] = {
    ...previous,
    ...media,
    size: size ?? previous?.size ?? null,
    etag: headers.etag ?? previous?.etag ?? null,
    lastSeenAt: Date.now()
  };
  session.detectedAt = Date.now();
  await persistSession(session);
  notify(details.tabId);
  if (!previous) schedulePartialBatchDownload(session);
  await maybeDownloadBatch(session, false);
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    handleMediaResponse(details).catch(() => {});
  },
  { urls: ["https://content.echo360.net.au/*"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PAGE_INFO" && sender.tab?.id != null) {
    const lessonPage = isLessonUrl(sender.url) && isLessonUrl(message.pageUrl);
    const sectionPage = isSectionUrl(sender.url) && isSectionUrl(message.pageUrl);
    if (!lessonPage && !sectionPage) {
      sendResponse({ ok: false, error: "許可されていないページです。" });
      return;
    }
    const session = getSession(sender.tab.id);
    const previousPage = parseEchoPageUrl(session.pageUrl);
    const nextPage = parseEchoPageUrl(message.pageUrl);
    const sameSection = previousPage?.kind === "section"
      && nextPage?.kind === "section"
      && new URL(previousPage.url).pathname === new URL(nextPage.url).pathname;
    session.kind = sectionPage ? "section" : "lesson";
    session.title = sanitizeFilename(message.title);
    session.pageUrl = message.pageUrl;
    session.documentId = sender.documentId ?? null;
    if (sectionPage) {
      session.lessons = normalizeLessonEntries(
        [...(sameSection ? session.lessons ?? [] : []), ...(message.lessons ?? [])],
        message.pageUrl
      );
      session.tracks = {};
    } else {
      session.lessons = [];
    }
    persistSession(session).then(
      async () => {
        notify(sender.tab.id);
        if (lessonPage) {
          const batch = await loadBatchState();
          if (batch?.status === "running" && batch.currentTabId === sender.tab.id) {
            await triggerBatchPlayback(sender.tab.id);
            const started = await maybeDownloadBatch(session, false);
            if (!started) schedulePartialBatchDownload(session);
          }
        }
        sendResponse({ ok: true });
      },
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }

  if (message?.type === "GET_SESSION") {
    loadSession(message.tabId).then((session) => {
      sendResponse({ session: publicSession(session) });
    });
    return true;
  }

  if (message?.type === "DOWNLOAD_TRACK") {
    loadSession(message.tabId).then(async (session) => {
      const validKey = typeof message.trackKey === "string" && /^[012]:\d+$/.test(message.trackKey);
      const track = validKey && session && Object.hasOwn(session.tracks, message.trackKey)
        ? session.tracks[message.trackKey]
        : null;
      if (!session || !track) {
        sendResponse({ ok: false, error: "トラックが見つかりません。動画を少し再生してください。" });
        return;
      }

      try {
        const downloadId = await startTrackDownload(
          session,
          track,
          bundleFolder(session, track.quality),
          Boolean(message.saveAs)
        );
        sendResponse({ ok: true, downloadId });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    });
    return true;
  }

  if (message?.type === "DOWNLOAD_BUNDLE") {
    loadSession(message.tabId).then(async (session) => {
      const quality = Number(message.quality);
      if (!Number.isSafeInteger(quality) || quality < 0 || quality > 9) {
        sendResponse({ ok: false, error: "品質指定が不正です。" });
        return;
      }
      const tracks = [0, 1, 2].map((source) => {
        const key = `${source}:${quality}`;
        return session && Object.hasOwn(session.tracks, key) ? session.tracks[key] : null;
      }).filter(Boolean);
      const hasAudio = tracks.some((track) => track.source === 0);
      const hasVideo = tracks.some((track) => track.source === 1 || track.source === 2);
      if (!session || !hasAudio || !hasVideo) {
        sendResponse({ ok: false, error: "音声と映像が揃っていません。動画を数秒再生してください。" });
        return;
      }

      const folder = bundleFolder(session, quality, true);
      try {
        const downloadIds = await Promise.all([
          ...tracks.map((track) => startTrackDownload(session, track, folder)),
          downloadMetadata(session, quality, tracks, folder)
        ]);
        sendResponse({ ok: true, downloadIds, folder: `Echo360/${folder}` });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    });
    return true;
  }

  if (message?.type === "START_SECTION_BATCH") {
    loadSession(message.tabId).then(async (session) => {
      if (!session || session.kind !== "section" || !isSectionUrl(session.pageUrl)) {
        sendResponse({ ok: false, error: "Echo360のsection一覧で実行してください。" });
        return;
      }
      try {
        await chrome.tabs.sendMessage(
          message.tabId,
          { type: "COLLECT_SECTION_LESSONS" }
        ).catch(() => null);
        session = await loadSession(message.tabId) ?? session;
        const state = await startSectionBatch(session);
        sendResponse({ ok: true, batch: publicBatchState(state) });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    });
    return true;
  }

  if (message?.type === "GET_BATCH_STATUS") {
    loadBatchState().then((state) => {
      sendResponse({ batch: publicBatchState(state) });
    });
    return true;
  }

  if (message?.type === "CANCEL_SECTION_BATCH") {
    cancelSectionBatch().then((state) => {
      sendResponse({ ok: true, batch: publicBatchState(state) });
    });
    return true;
  }

  if (message?.type === "CLEAR_SESSION") {
    sessions.delete(message.tabId);
    chrome.action.setBadgeText({ tabId: message.tabId, text: "" });
    chrome.storage.session.remove(storageKey(message.tabId)).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "PAGE_UNLOAD" && sender.tab?.id != null) {
    loadSession(sender.tab.id).then((session) => {
      if (sender.documentId && session?.documentId === sender.documentId) {
        sessions.delete(sender.tab.id);
        chrome.storage.session.remove(storageKey(sender.tab.id)).catch(() => {});
        chrome.action.setBadgeText({ tabId: sender.tab.id, text: "" }).catch(() => {});
      }
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  sessions.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId)).catch(() => {});
  loadBatchState().then((state) => {
    if (
      state?.status === "running" &&
      state.currentTabId === tabId &&
      state.currentStage !== "ダウンロードを開始しています"
    ) {
      finishCurrentBatchEntry(state, false, "授業タブが閉じられました。").catch(() => {});
    }
  });
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  loadBatchState().then((state) => {
    if (
      state?.status === "running" &&
      state.currentTabId === tabId &&
      state.currentStage !== "ダウンロードを開始しています"
    ) {
      state.currentStage = "メディアを検出しています";
      persistBatchState(state).then(() => triggerBatchPlayback(tabId));
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith("echo360-batch:")) return;
  loadBatchState().then(async (state) => {
    if (
      state?.status === "running" &&
      batchAlarmName(state) === alarm.name
    ) {
      const session = await loadSession(state.currentTabId);
      const started = session ? await maybeDownloadBatch(session, true) : false;
      if (!started) {
        const latest = await loadBatchState();
        if (
          latest?.id !== state.id ||
          latest.currentTabId !== state.currentTabId ||
          latest.currentStage === "ダウンロードを開始しています"
        ) return;
        await finishCurrentBatchEntry(
          latest,
          false,
          "時間内に音声と映像を検出できませんでした。"
        );
      }
    }
  }).catch(() => {});
});
