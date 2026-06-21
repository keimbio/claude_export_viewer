# Instructions

Three short tasks: get your export, add your background images, then open the app (locally or on GitHub Pages).

---

## 1. Get your export from Claude

1. In Claude, go to **Settings → Account → Request Export**.
2. Wait for the email with the download link (it can take a little while).
3. Download and save the `.zip`. Keep it as-is — you can drop the whole `.zip` into the viewer, or the `conversations.json` from inside it.

---

## 2. Add your background images (optional but recommended)

Copy your four image files into the `assets/backgrounds/` folder inside this project, named **exactly**:

```
DARK-MODE-susan-wilkinson-4rDgxdT_4wI-unsplash.jpg
DARK-MODE-pawel-czerwinski-4x3VAM19wDA-unsplash.jpg
LIGHT-MODE-aljoscha-laschgari-Nm_liipBlsY-unsplash.jpg
LIGHT-MODE-susan-wilkinson-_vpDiW27L0k-unsplash.jpg
```

The names must match for the four built-in presets to find them. If you skip this, the app just uses a solid background — and you can always upload any image from inside the app via ⚙ → Appearance → Background image → **+ Upload**.

You can delete `assets/backgrounds/PLACE_IMAGES_HERE.txt` once your images are in.

---

## 3a. Run it locally

**Easiest:** double-click `index.html`. It opens in your default browser and works offline.

**If fonts or imports don't load** (some browsers restrict `file://` pages), serve it locally instead. Open Terminal, change into this folder, and run:

```
cd "/path/to/claude-export-viewer"
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. To get the path right, you can drag the `claude-export-viewer` folder from Finder into the Terminal window after typing `cd ` (with a trailing space). Press `Ctrl + C` in Terminal to stop the server when you're done. Nothing leaves your machine.

---

## 3b. Deploy on GitHub Pages

1. Create a new repository on GitHub (e.g. `claude-export-viewer`).
2. Upload the entire contents of this folder to the repo (including the `.nojekyll` file — it prevents Pages from mangling the folder structure). If `.nojekyll` is hidden in Finder, press `Cmd + Shift + .` to reveal hidden files.
3. In the repo, go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**, pick your `main` branch and the `/ (root)` folder, and save.
5. Wait a minute, then visit `https://<your-username>.github.io/<repo-name>/`.

Note: if you deploy to GitHub Pages, your conversations are still only loaded in *your* browser when you use the app — the export files you drop in are never uploaded to GitHub. But the app's *code* is public on Pages, so don't commit your actual export `.zip` or your `conversations.json` into the repo.

---

## Using the app

- **Import:** drag a `.zip`/`.json` onto the drop area, or click **Choose file**. Import more files anytime; they merge and de-duplicate automatically.
- **Browse:** click a conversation in the left list. Search with the box; switch the scope between Title and Full text; toggle "Has artifacts"; set a date range; sort by created/modified, newest/oldest.
- **Copy:** the small button under any bubble copies that bubble. The conversation toolbar copies the whole chat (formatted or plain).
- **Select & export:** click **Select**, tick the bubbles you want, then **Export** to choose txt / md / json / pdf / png.
- **Export a conversation:** use the conversation's **Export** menu — md, txt, json, html, pdf, png, or a zip of its artifacts.
- **Export everything:** **Library** menu → merged JSON, or a structured ZIP of the whole library.
- **Artifacts:** open one to view it (SVG/markdown/HTML render; code shows formatted), then download it in its original type or an alternative.
- **Appearance:** the ⚙ button — theme, background image + opacity, and text size. The A−/A+ buttons in the toolbar also resize text.

---

## Troubleshooting

- **A conversation won't load / "invalid":** the import summary lists which conversations were skipped and why. If a whole file fails, confirm it's a Claude export (`conversations.json` or the `.zip` containing it) and not, say, `users.json` on its own.
- **Backgrounds don't show:** check the filenames in `assets/backgrounds/` match exactly (capitalisation and the long unsplash IDs included).
- **Fonts look generic when opened by double-click:** use the `python3 -m http.server` method above.
- **An uploaded image attachment won't display:** that's expected — Claude's export doesn't include the original image files, only their extracted text. See the note in `README.md`.
