# InkStone for Obsidian

See your notes the way your InkStone site will show them, without leaving Obsidian. The plugin runs a local InkStone server and shows the real rendered page next to your note.

- **Live preview of the real site.** It's the actual InkStone output, not an approximation.
- **Two-way navigation sync.** Switch notes in the editor and the preview follows. Click a link in the preview and the editor opens that note.
- **Owner view.** Toggle it to see private notes the way you'd see them as the site owner.
- **Auto-reload on save.** The preview refreshes when you save.
- **Git panel.** Pull, commit, push and view diffs for your site folder, using your own git setup.

**Early release.** This is 0.1.0. The unit tests pass, but nobody has run the plugin in a live Obsidian yet, so expect rough edges. Please report what you hit.

## Requirements

- Obsidian desktop. Mobile isn't supported, because the plugin starts a local process.
- A local InkStone checkout at version 1.57.0 or newer, with its Python environment set up (the default is a `.venv` inside the checkout).
- `git`, if you want to use the git panel.

## Install

**Manual.** Download `main.js`, `manifest.json` and `styles.css` from the latest GitHub release and put them in `<vault>/.obsidian/plugins/inkstone-preview/`. Then enable the plugin in Settings > Community plugins.

**BRAT.** Add the repo `airenare/inkstone-obsidian-plugin` in the BRAT plugin and let it install and update the release for you.

## Settings

| Setting | What it does |
| --- | --- |
| Site folder | The folder with your site notes. Any folder in the vault or on disk. |
| InkStone checkout | The folder where you cloned InkStone (the one with `app.py`). |
| Python executable | Defaults to the checkout's venv: `<checkout>/.venv/bin/python3` on macOS and Linux, `<checkout>\.venv\Scripts\python.exe` on Windows. It needs InkStone's requirements installed. |
| Start server automatically | Starts the preview server when Obsidian opens. |

The settings tab checks your choices and tells you what's wrong, such as a missing `app.py` or a Python without Flask.

## Git panel

What the buttons do depends on the state of the site folder:

| Folder state | Pull | Commit | Push |
| --- | --- | --- | --- |
| Not a git repo | Disabled ("Folder is not a git repo") | Disabled (same hint) | Disabled (same hint) |
| Repo, no remote | Disabled ("No remote configured") | Enabled | Disabled ("No remote configured") |
| Repo with a remote | Enabled | Enabled | Enabled |

Hover a disabled button to see why. Large or binary diffs are truncated or skipped instead of rendered.

## Privacy and security

- The plugin never stores credentials. The Owner view token is random, kept in memory, and only sent to the local InkStone server the plugin started.
- Git runs with your existing git config and credentials. The plugin never touches them.
- The dev source-map endpoint (used for syncing the preview back to the editor) exists only when the plugin starts InkStone itself with `INKSTONE_DEV_API=1`. A server you run on your own doesn't get it.

## Known limitations

- Early 0.1.0 release: unit tests pass, but it hasn't been tested in a running Obsidian yet. Two things are especially unverified: whether an external link navigation really gets stopped in the preview, and the final URL after the Owner view token redirect.
- Links with `target="_blank"` do nothing in the preview.
- If Obsidian is hard-killed, the local server can keep running until you end it yourself.
- A `.env` file with `URL_PATH_PREFIX` isn't supported.
- macOS, Linux and Windows are all supported, but so far the Linux and Windows paths have only been covered by unit tests. Reports are welcome.

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
