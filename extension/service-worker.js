import {
  headersToObject,
  parseContentRange,
  parseMediaUrl,
  sanitizeFilename
} from "./media-model.js";

const sessions = new Map();
const storageKey = (tabId) => `session:${tabId}`;

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
    title: session.title,
    pageUrl: session.pageUrl,
    detectedAt: session.detectedAt,
    tracks: Object.fromEntries(
      Object.entries(session.tracks).map(([key, track]) => [key, {
        file: track.file,
        source: track.source,
        quality: track.quality,
        trackType: track.trackType,
        size: track.size,
        etag: track.etag,
        safeUrl: track.safeUrl
      }])
    )
  };
}

function notify(tabId) {
  const count = Object.keys(getSession(tabId).tracks).length;
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#7c3aed" });
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
  chrome.runtime.sendMessage({ type: "SESSION_UPDATED", tabId }).catch(() => {});
}

function lectureDate(pageUrl) {
  return pageUrl.match(/_(\d{4}-\d{2}-\d{2})T/)?.[1] ?? "undated";
}

function bundleFolder(session) {
  return `${sanitizeFilename(session.title)}_${lectureDate(session.pageUrl)}`;
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
    conflictAction: "overwrite"
  });
}

async function downloadMetadata(session, quality, tracks, folder) {
  const metadata = {
    schemaVersion: 1,
    title: session.title,
    lectureDate: lectureDate(session.pageUrl),
    quality,
    createdAt: new Date().toISOString(),
    sourcePage: session.pageUrl,
    tracks: tracks.map((track) => ({
      role: track.trackType === "audio" ? "audio" : `source-${track.source}`,
      filename: trackFilename(track),
      size: track.size,
      etag: track.etag
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
    conflictAction: "overwrite"
  });
}

async function handleMediaResponse(details) {
  if (details.tabId < 0) return;
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
    const session = getSession(sender.tab.id);
    session.title = sanitizeFilename(message.title);
    session.pageUrl = message.pageUrl;
    persistSession(session).then(
      () => sendResponse({ ok: true }),
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
      const track = session?.tracks?.[message.trackKey];
      if (!session || !track) {
        sendResponse({ ok: false, error: "トラックが見つかりません。動画を少し再生してください。" });
        return;
      }

      try {
        const downloadId = await startTrackDownload(
          session,
          track,
          bundleFolder(session),
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
      const tracks = [0, 1, 2].map((source) => session?.tracks?.[`${source}:${quality}`]);
      if (!session || tracks.some((track) => !track)) {
        sendResponse({ ok: false, error: "3トラックが揃っていません。動画を数秒再生してください。" });
        return;
      }

      const folder = bundleFolder(session);
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

  if (message?.type === "CLEAR_SESSION") {
    sessions.delete(message.tabId);
    chrome.action.setBadgeText({ tabId: message.tabId, text: "" });
    chrome.storage.session.remove(storageKey(message.tabId)).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  sessions.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId)).catch(() => {});
});
