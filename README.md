# Claude Export Viewer

A private, self-contained web app for browsing, searching, and exporting your Claude conversation history. Drop in the `.zip` (or `conversations.json`) you get from Claude's data export and read your chats back in a clean, DM-style layout — with the artifacts Claude made reconstructed as real, downloadable files.

It runs **entirely in your browser**. There is no backend, no server, no account, no analytics, and no external CDN — every library and font is bundled in this repo. Your conversations never leave your device. The whole thing is plain HTML, CSS, and vanilla JavaScript with no build step, so you can read every line before you trust it.

## Why

Existing viewers tend to break on older conversations and on any chat containing artifacts, failing with errors like "No valid conversations found." Claude's export stores artifacts not as finished files but as a sequence of edit commands (create → rewrite → small `old_str → new_str` patches), and it stores message text in more than one layout depending on the chat's age. This viewer replays the artifact commands in order to rebuild each artifact's final state, and it understands both the old and new message layouts — so it loads the conversations other tools reject.

## Features

- **Reads `.zip` or `conversations.json`** exports — titles, created/updated timestamps, every human and assistant turn, attachments, and artifacts.
- **Reconstructs artifacts** and saves them with the correct file type (`.py`, `.md`, `.svg`, `.html`, etc.).
- **Merge multiple exports** into one library, automatically de-duplicated (newest copy of a conversation wins) and sortable by date or title.
- **Copy** any single message, or a whole conversation (formatted or plain).
- **Export** selected messages or whole conversations to **txt, md, json, pdf, or png**; **select multiple conversations** in the sidebar (☑ Select) and export them together as a ZIP, merged JSON, combined Markdown, or combined PDF; export a conversation's artifacts as a zip; or **export the entire library** at once (⤓ Export all).
- **Search & filter** by title or full text, restrict to conversations containing artifacts, set a date range, and sort newest/oldest by created or modified date.
- **Appearance** — dark-mode-first glassmorphism in blues/greens/greys, all text in Hanken Grotesk, adjustable text size, a light theme, and an optional semi-transparent background image with an opacity slider.

## Privacy

Everything happens client-side. The export files you load are read in your browser's memory and stored only in your browser's local database (IndexedDB) so your library persists between visits. Nothing is transmitted anywhere. Even when this app is hosted on GitHub Pages, the page's *code* is public but *your data* is not — the conversations you load are never uploaded to GitHub or anyone else. (For that reason, don't commit your own export files into a public fork — see below.)

## Quick start

**Use it hosted:** if it's deployed on GitHub Pages, just open the Pages URL and drop your export in.

**Run it locally:** download or clone this repo, then open `index.html` in your browser. If your browser restricts loading the bundled fonts/scripts from a `file://` page, serve it locally instead:

```
python3 -m http.server 8000
```

from the project folder, then visit `http://localhost:8000`. Nothing is served beyond your own machine.

**Host your own copy on GitHub Pages:** fork or upload this repo, then in **Settings → Pages**, set the source to your `main` branch and `/ (root)`. The included `.nojekyll` file ensures the files are served as-is. See `INSTRUCTIONS.md` for the detailed walkthrough.

## Background images

The four background presets are referenced by filename but are **not** included in this repo. To enable them, place your own images in `assets/backgrounds/` using the exact names listed in that folder's note. If they're absent, the app falls back to a solid color — nothing breaks — and you can upload any image as a background from inside the app (⚙ → Appearance → Background image → **+ Upload**).

## Getting your Claude export

In Claude: **Settings → Account → Request Export**. You'll receive an email with a download link; save the `.zip` and drop it (or the `conversations.json` inside it) into the viewer.

## Known limitation

Claude's export does not include the original binary attachments — the actual image or PDF files you uploaded to a chat. It stores only the *extracted text* of those attachments plus their metadata. The viewer shows that text and the attachment's name and type, but it cannot display the original image, because the image isn't in the export. No viewer can recover what the export doesn't contain.

## How it works

`js/parser.js` reads the export and rebuilds artifacts; `js/export.js` produces every download format; `js/app.js` drives the UI, search, library storage, and settings. There's no framework and no build tooling — open the files and read them.

## Contributing / forking

This is a personal project shared in case it's useful to others. Feel free to fork it. If you do, make sure your `.gitignore` excludes your own export files (`conversations.json`, `*.zip`) so you never publish your chat history by accident.

## License

Released under the [MIT License](LICENSE). The MIT license covers the original application code in this repository. Bundled third-party dependencies and assets retain their own licenses, listed below.

## Acknowledgements

The application code (the parser, exporters, UI, and the lightweight Markdown renderer) is original to this project. It stands on the following bundled open-source libraries, font, and images, with thanks to their authors:

- **JSZip** (v3.10.1) — reads and writes `.zip` files. © Stuart Knightley, dual-licensed MIT / GPLv3 (used here under MIT). Includes **pako** (MIT) by Vitaly Puzrin and Andrey Tupitsin.
- **jsPDF** (v4.2.1) — PDF generation. © James Hall and yWorks GmbH, MIT License.
- **html2canvas** (v1.4.1) — renders DOM nodes to PNG. © Niklas von Hertzen, MIT License.
- **Hanken Grotesk** — the typeface used throughout, designed by Alfredo Marco Pradil and distributed via [Fontsource](https://fontsource.org). Licensed under the SIL Open Font License 1.1. Also embedded into exported PDFs so they match the app.
- **DejaVu Sans Mono** — the monospace font embedded in exported PDFs for code blocks (a free, public-domain-style face in the lineage that Menlo descends from). [DejaVu Fonts](https://dejavu-fonts.github.io/), free license.
- **Background photographs** — provided via [Unsplash](https://unsplash.com) under the Unsplash License, by Susan Wilkinson, Paweł Czerwiński, and Aljoscha Laschgari. (Not committed to this repo; supplied by the user.)

Design language adapted from the author's own [PCR-Calculator-Q5](https://keimbio.github.io/PCR-Calculator-Q5/).

Scaffolding and code authored with assistance from Claude (Anthropic).
