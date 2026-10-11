# TELC C1 Trainer

A local-first study app for personal telc C1 Hochschule practice. The app is client-side: question banks, audio files, drafts, settings, and results stay in the current browser's IndexedDB. There is no account, server database, AI integration, analytics, or automatic upload.

## Requirements

- Node.js 20.19 or newer (Node 24 is used in the development environment)
- pnpm 11.25.0

Install the dependencies and run the app:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:5173>. The development server uses Vite's history fallback, so refreshing a nested route works while the server is running.

## Publish on GitHub Pages

The repository is configured to build and deploy the `main` branch with GitHub Actions. After pushing it to a public repository named `telc-c1-trainer`, enable **Settings → Pages → Build and deployment → GitHub Actions**. The site URL will be `https://<your-github-name>.github.io/telc-c1-trainer/`.

Pages uses hash-based routes, so refreshing a page such as `/#/library` continues to work. Each visitor's question bank, recordings, drafts, settings, and history stay in that visitor's browser; publishing the app does not upload your local IndexedDB data. Anyone can access the public source and hosted app.

## Commands

```sh
pnpm dev          # local development server
pnpm typecheck    # TypeScript check
pnpm test         # unit and UI integration tests
pnpm build        # type check and production build
pnpm preview      # serve the production build locally
```

The Codex development environment bundles Node.js and pnpm outside the normal shell PATH. In that environment, prepend the bundled Node directory and invoke its pnpm binary. On an ordinary machine, install Node.js and pnpm as above.

## First version

- Create, edit, copy, and delete question sets and questions in the site.
- Attach one shared reading passage or audio file to a set.
- Practice single choice, multiple choice, matching, Richtig/Falsch/Nicht im Text, Textrekonstruktion, and answer-variant gap-fill questions.
- Use practice mode or a countdown exam mode; submit for deterministic scoring, explanations, history, and wrong-answer redo.
- Import/export JSON question banks and CSV question sets. Imports are schema-checked and previewed before writing. Duplicate handling offers skip (default), replace, or copy.
- Download and restore a full local backup containing question banks, passages, audio, results, and settings.
- Save writing drafts, speaking notes/transcripts, locally recorded speaking responses, rubrics, optional self-assessment, and feedback.

An original, small practice bank is provided in `examples/example-question-bank.json`. It is authored for demonstrating the format and is **not** official telc material. The app does not seed it into a new user's library; import it only if useful.

## Data and privacy

The IndexedDB database is named `telc-c1-trainer`. In-progress practice answers are saved locally and restored after refresh. Audio files are limited to 25 MB each and supported common browser audio MIME types. Import files are capped in the interface; full backups may be up to 100 MB. The app shows an approximate browser storage usage estimate when the browser exposes it and rejects audio uploads that would consume nearly all of the reported quota. Browser storage can still be cleared or evicted; keep a backup in a separate safe location.

Use **Einstellungen → Download full JSON backup** regularly. Backups include in-progress answers. Restore validates the full payload before applying changes and runs the database updates in one IndexedDB transaction. Skip is the default duplicate policy. Choosing replace intentionally overwrites matching IDs; copy gives bank items new IDs and imports copied result snapshots. JSON bank export contains base64-encoded audio and can be large. CSV covers questions and their answer data, but does not include passages or audio.

All authored content is rendered as text; user text is never inserted as HTML. CSV export prefixes spreadsheet formula-like cells and removes that protective prefix on re-import. The app has no network client calls to an AI provider and no place to configure API secrets. The stylesheet uses system fonts and makes no third-party font requests.

## Data model

See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) for record relationships, question-specific fields, validation, scoring, and the JSON/CSV formats.

## Not in this version

- German-localized interface (interface labels are currently Chinese, with German exam terms).
- Automated AI evaluation, AI service configuration, or any remote service. Adding AI requires a separate server-side proxy and explicit consent before sending private content.
- Cloud sync, user accounts, cross-device backup, and audio transcoding.
- Full telc scoring calibration or official past-paper content.

## Tests

Vitest covers schema validation, objective scoring (including multi-select, matching, text reconstruction, and accepted gap variants), JSON/CSV validation and round-trip behavior, transactional imports, IndexedDB persistence, audio validation, immutable attempt snapshots, and UI integration flows from authoring through scoring and refresh-restoring an in-progress answer. The installed-browser smoke check covers routing, refresh, mobile overflow, and console warnings. Recording still needs a browser microphone permission and a real device for end-to-end verification.
