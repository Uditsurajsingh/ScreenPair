# ScreenPair

ScreenPair is an Electron desktop assistant that captures the current screen, combines it with a user-defined engineering objective and optional project files, and sends the resulting multimodal request to an OpenAI-compatible Chat Completions API. Each completed interaction is recorded as a session step and can be exported to a Microsoft Word report with screenshots, actions, commands, verification criteria, and warnings.

## Core capabilities

- Manual and interval-based screen capture
- OpenAI-compatible raw HTTP API integration
- Configurable API endpoint and model ID
- GPT-5, GPT-5 mini, GPT-5 nano, GPT-4.1 mini, GPT-4o mini, and custom model support
- Runtime model discovery through the `/v1/models` endpoint
- Local extraction of PDF, DOCX, source-code, CSV, JSON, Markdown, and text files
- Structured software-engineering guidance in JSON
- In-memory session history
- Word export with screenshots
- Optional Word template used as the base report document
- Windows and macOS development support

## Architecture

```text
src/
├── main.js                 Electron main process, IPC, API calls, file extraction, report export
├── preload.js              Narrow context-isolated renderer bridge
└── renderer/
    ├── index.html          Application shell and settings UI
    └── renderer.js         Renderer state and user interactions
```

The renderer never receives Node.js primitives directly. Privileged operations are exposed through a constrained preload bridge and executed in the Electron main process.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Windows 10/11 or a currently supported macOS release
- An API key for an OpenAI-compatible Chat Completions endpoint

## Local setup

```bash
git clone https://github.com/Uditsurajsingh/ScreenPair.git
cd ScreenPair
npm install
npm start
```

On Windows, `start-screenpair.ps1` installs dependencies when required and starts the application.

## Configuration

Open **Settings** in the application and configure the API key, endpoint, model, automatic-capture interval, optional Word template, and system prompt.

Default endpoint:

```text
https://api.openai.com/v1/chat/completions
```

The actual models available depend on the API account. Use **Load available models** to query the configured provider.

## Security and privacy

ScreenPair can transmit everything visible on the selected screen. Automatic capture must be paused before opening credentials, private communications, regulated data, confidential source code, or personal information.

The current implementation stores the API key locally through `electron-store`. This is suitable for development and review, but production distribution should move secrets to the operating-system credential vault.

See [SECURITY.md](SECURITY.md) for the current threat model and hardening backlog.

## Quality checks

```bash
npm run check
npm test
```

Continuous integration validates installation and syntax on Windows, macOS, and Linux runners.

## Packaging status

This repository currently provides a development-grade Electron application. Signed Windows and macOS installers require publisher identities, platform-specific signing certificates, hardened runtime configuration, and release secrets. Those assets are intentionally not committed.

## Engineering-review priorities

1. API compatibility across OpenAI-compatible providers
2. Secret storage and privacy controls
3. Payload-size and context-selection strategy
4. Report-template compatibility
5. Session persistence and crash recovery
6. Testability of Electron IPC and document export
7. Packaging, signing, update delivery, and telemetry policy

## License

MIT. See [LICENSE](LICENSE).
