# Adding payloads

Upload an ELF file directly into `payloads/` on `main`. After GitHub Pages finishes publishing, refresh the PS5 page: the file automatically gets a button. Renaming or deleting a file updates the menu too. Files in subfolders, .bin files and .sha256 files are not listed.

## Optional title and description

Edit `_data/payloads.json` in GitHub. Add an entry using the exact filename (including capitalization):

```json
"mi-payload.elf": {
  "title": "Mi payload",
  "description": "Lo que hace este payload.",
  "info": "v1.0 - Autor",
  "order": 20
}
```

This is an entry inside the existing JSON object, not a replacement for the whole file. Separate entries with commas; do not put a comma after the last entry. GitHub Pages rebuilds after you save.

All fields are optional. Without metadata, the title comes from the filename, the description is empty and the info shows the filename. Lower `order` values appear first; entries without an order follow the existing buttons, sorted by title.

Use `"hidden": true` to keep an ELF in the repository without showing a menu button. The ELF loader, duplicate PLK binary and older offline installer are initially hidden. Remove that flag to display them.

Metadata alone does not create a button: the ELF must exist in `payloads/`.

## How it works

GitHub Pages/Jekyll generates `payloads/catalog.js` from the actual files and metadata during its existing build. The browser loads the generated catalog before creating the buttons; it does not need to call the GitHub API or use a token.

The existing sender still validates the ELF signature and enforces its 4 MiB limit. Listing a file does not guarantee compatibility with your PS5 firmware.

This automatic catalog requires a Jekyll build. Serving the raw checkout without building keeps the previous fixed menu as a fallback. Already-installed offline copies must be refreshed separately; uploading a file updates the hosted menu, not the offline updater's separate manifest.
