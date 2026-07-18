# Privacy

Echo360 Downloader does not collect analytics, transmit telemetry, or send data to a project-operated server.

## Chrome extension

The extension processes the following data locally:

- the title and URL of the active Echo360 lesson;
- Echo360 content URLs observed while the lesson is playing;
- media type, quality, file size, and ETag response metadata.

Authenticated content URLs may contain identifiers and are treated as sensitive. They are stored only in `chrome.storage.session`, which is memory-backed, restricted to trusted extension contexts, and cleared when the tab or browser session ends. Authentication cookies and authorization headers are not read by the extension.

The generated `echo360.json` contains the lecture title, date, quality, local filenames, expected sizes, and output filenames. It does not contain cookies, JWTs, signed media URLs, ETags, or the source lesson URL.

## CLI

The CLI reads local files selected through `echo360.json` and invokes the locally installed `ffmpeg` executable without using a shell. It does not make network requests.

## Removal

Uninstalling or reloading the extension clears its session data. Downloaded files can be removed through the operating system like any other local file.
