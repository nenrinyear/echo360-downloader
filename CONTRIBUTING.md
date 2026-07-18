# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Development

Requirements:

- Node.js 18 or later;
- Google Chrome 102 or later;
- FFmpeg for end-to-end CLI testing.

Run the automated checks with:

```sh
npm test
```

Load `extension/` as an unpacked extension for manual testing. Never commit or attach cookies, JWTs, signed URLs, HAR files containing authentication data, student identifiers, or downloaded lecture media. The ignored `export/` directory is intended for local fixtures only.

## Pull requests

- Keep host permissions as narrow as possible.
- Do not add remote code, analytics, or telemetry without prior discussion.
- Add tests for parsers, metadata validation, and CLI filesystem behavior.
- Confirm that new dependencies have licenses compatible with MIT distribution and document them in `THIRD_PARTY_NOTICES.md`.
- Do not implement DRM bypasses or authorization-control circumvention.

Report security issues according to [SECURITY.md](SECURITY.md), not in a public issue.
