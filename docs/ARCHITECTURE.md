# Architecture

## Process boundaries

ScreenPair uses Electron's standard three-part model.

- **Main process:** owns filesystem access, screenshots, settings, network calls, document parsing, session state, and Word export.
- **Preload bridge:** exposes a small, named IPC API through `contextBridge`.
- **Renderer:** owns presentation and user interaction only. Node integration is disabled and context isolation is enabled.

## Request lifecycle

1. The renderer asks the main process for a screenshot.
2. The renderer submits the screenshot and objective for analysis.
3. The main process adds prior-step and background-file context.
4. The main process sends a multimodal Chat Completions request.
5. The response is parsed and normalized into state, next action, details, commands, verification, and warnings.
6. The renderer displays the result and asks the main process to record the step.
7. Export serializes all steps and screenshots into a DOCX report.

## Design constraints

- Suggested commands are displayed, never executed.
- API-provider compatibility is isolated in the main-process request function.
- Local file extraction is bounded per file, but token-aware context selection remains future work.
- Session state is currently in memory and is lost when the process exits.
- The Word-template implementation appends generated Open XML to an existing DOCX package; complex templates require expanded compatibility testing.

## Recommended refactoring

Before a production release, split `main.js` into services for configuration, capture, API transport, context extraction, session management, and report generation. Each service should have unit tests independent of Electron.
