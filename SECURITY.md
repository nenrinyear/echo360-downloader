# Security Policy

## Supported versions

Security fixes are applied to the latest revision on the default branch.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that may expose authentication data, overwrite local files, or enable unintended access to media.

Use [GitHub private vulnerability reporting](https://github.com/nenrinyear/echo360-downloader/security/advisories/new) instead. Include reproduction steps, affected files, and the expected impact. Do not include live Echo360 cookies, JWTs, signed URLs, student identifiers, or copyrighted media.

## Security boundaries

- The extension observes only requests initiated by `https://echo360.net.au` to the configured Echo360 content host.
- Section batch processing follows only validated `https://echo360.net.au/lesson/` URLs discovered on an authorized section page and never reads cookies or authorization headers.
- Authenticated media URLs are held in Chrome's in-memory extension session storage and are not written to `echo360.json`.
- The CLI treats `echo360.json` as untrusted input, rejects path traversal and symlinks, and writes through temporary files before replacing an output.
- Source cleanup validates every required non-empty output and every original track before deleting only the exact files named by `echo360.json`; metadata and merged outputs are retained.
- This project does not bypass DRM or Echo360 authorization controls.
