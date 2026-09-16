# Fluxion application artwork

These files are byte-for-byte imports from the project owner's `app-icons.zip`,
supplied for Fluxion on 2026-09-16. They replace the earlier application artwork
without redrawing it or generating alternatives. The supplied shaded silver F
is used as application identity; it does not change the restrained browser UI.

| Imported file | Original archive member | SHA-256 |
| --- | --- | --- |
| `app-icon-1024.png` | `ios/AppIcon~ios-marketing.png` | `5600c94e5e6e93505add8cf0a1210bed1bd7b6e03e6f9b745eb51a2a739cde10` |
| `app-icon-512.png` | `web/icon-512.png` | `f2709be2433bd2e207f3222306e98e5d66d8d3471d6c55c7e13af77fbf290b16` |
| `favicon.png` | `web/favicon.ico` | `f82cad26c3098094c8595cece5ddf95bd4e7cf1aab917e499f6d83258d9ed006` |

The archive SHA-256 is
`a190f19f2947ca981c1494c9e281c257a163628b778570e86be51088b2dbc301`.
The original archive and unrelated mobile packaging files are not shipped.
The archive's `.ico` file actually contains a 32px PNG. Its bytes are preserved,
with a corrected filename and PNG MIME type in the new-tab document.

The macOS builder derives its native ICNS representations from the 1024px PNG;
Dock/Finder application identity and existing file associations use that ICNS.
About Fluxion uses the supplied 512px PNG, and the blank new-tab document uses
the supplied favicon. Normal website favicons are left untouched.
