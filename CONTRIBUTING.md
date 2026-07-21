# Contributing

## Development workflow

1. Create a focused branch from `main`.
2. Keep pull requests small and explain user-visible behavior, security implications, and test coverage.
3. Run `npm install`, `npm run check`, and `npm test` before opening a pull request.
4. Do not commit API keys, screenshots containing private data, generated reports, `node_modules`, or signing credentials.

## Commit style

Use concise conventional-style prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:`.

## Review checklist

- IPC surface remains minimal and context isolation remains enabled.
- Renderer code does not gain direct Node.js access.
- Model output is treated as untrusted data.
- Automatic capture behavior is visible and reversible.
- File processing has bounded memory and payload behavior.
- Changes work on Windows and macOS or document platform limitations.
