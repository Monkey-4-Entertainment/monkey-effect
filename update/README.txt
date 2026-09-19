Monkeyeffect online update v1.0.8.9

Feed:
https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json

Package:
https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/Monkeyeffect-1.0.8.9-update.zip

SHA-256: 8df8e51291d719bc0066e9e39839eddc98026eefeee4918106909bf9a43dfc1f
Size: 84,244,063 bytes

Changes:
- Gift size follows per-item coin value, capped at 3x. Combo count does not inflate individual gifts.
- Glass walls, floor, artwork and mouth now align.
- Gifts remain inside until a stable supported pile reaches the mouth.
- Overflow clears the rim before moving outside; combo bursts do not create overlapping spawns.
- Resizing preserves counts and gift sizes.
- Existing FARM preset editor/backend and assets remain included.

This frontend hotfix keeps the tested 1.0.8.8 backend binary unchanged.
App and updater version endpoints use wwwroot/version.json (1.0.8.9).
No userdata, media cache, logs, scratch files or backups are shipped.
14 isolated browser/physics test groups passed, including 400 gifts in each of 5 jar styles.

Publish latest.json, feed.json and the versioned ZIP together.
Verify the public ZIP SHA-256 before announcing release availability.
