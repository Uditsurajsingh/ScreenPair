# Security

## Supported versions

The project is under active development. Security fixes are applied to the latest `main` branch only.

## Reporting a vulnerability

Do not publish API keys, screenshots, private files, or exploit details in a public issue. Contact the repository owner privately with reproduction steps and impact.

## Current threat model

ScreenPair processes screenshots, API credentials, project files, and generated reports. Primary risks are accidental capture of sensitive information, plaintext local API-key storage, oversized or malicious document inputs, untrusted API endpoints, and unsafe assumptions about model output.

## Known hardening backlog

- Store API credentials in the operating-system keychain.
- Add explicit capture-area and display selection.
- Add sensitive-window deny lists and capture confirmation.
- Enforce endpoint allow-listing or prominent trust warnings.
- Add file-size, MIME-type, archive, and parser resource limits.
- Persist sessions with encryption and crash recovery.
- Add content-security-policy tests and dependency auditing.
- Sign and notarize production installers.

The application does not execute commands returned by the model. This boundary must remain explicit.
