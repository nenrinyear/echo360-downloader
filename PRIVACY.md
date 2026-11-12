# Privacy

Echo360 Downloader does not collect analytics, transmit telemetry, or send data to a project-operated server.

## Chrome extension

The extension processes the following data locally:

- the title and URL of the active Echo360 lesson;
- the titles and lesson URLs visible in an active Echo360 section page while a batch is running;
- Echo360 content URLs observed while the lesson is playing;
- media type, quality, file size, and ETag response metadata.

Authenticated content URLs may contain identifiers and are treated as sensitive. They are stored only in `chrome.storage.session`, which is memory-backed, restricted to trusted extension contexts, and cleared when the tab or browser session ends. Authentication cookies and authorization headers are not read by the extension.

Section batch state is also stored only in `chrome.storage.session`. The extension opens each listed lesson in the same Chrome profile so that Echo360 applies the user's existing authenticated session and permissions.

The path relative to Chrome's configured download directory is stored in `chrome.storage.local` so the preference persists across browser restarts. This setting contains no authentication data.

The generated `echo360.json` contains the lecture title, date, quality, local filenames, expected sizes, and output filenames. It does not contain cookies, JWTs, signed media URLs, ETags, or the source lesson URL.

## CLI

The CLI reads local files selected through `echo360.json` and invokes the locally installed `ffmpeg` executable without using a shell. It does not make network requests.

## Removal

Uninstalling or reloading the extension clears its session data. Uninstalling the extension also removes its locally stored download-folder preference. Downloaded files can be removed through the operating system like any other local file.
