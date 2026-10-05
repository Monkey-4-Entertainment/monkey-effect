Monkeyeffect online update pack v1.2.6

Feed: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json
Zip: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/Monkeyeffect-1.2.6-update.zip
SHA256: 5aa5b47d8c3369afdb94405ab82aeef747c208bddf8104897f6207f9481aad94

Changes:
- Removed Daily TTS Snippets and its timed speech scheduler.
- Transparent welcome frames with four visual styles and distinct LV 20/30/40/50 tiers.
- Sultan Top 3 animated rings with portraits, names and saved drag positions.
- Native speech continues while minimized; bounded requests, cancellation, queue recovery and process health checks.
- 15 built-in voice choices and 26 optional Paxa voices, including Northern, Isan and Southern.
- Paxa key is encrypted per Windows user; dialect wording conversion is experimental and can be previewed.

Validation:
- Frontend queue/deadline/stop and native host recovery tests passed.
- All 14 Edge voices synthesized Thai successfully; Google remains a backup choice.
- Regional provider contracts, filtering, missing-key and cancellation tests passed.
- Real Paxa synthesis and dialect wording quality need validation with an account API key.
- Minimized playback and native Stop verified in the installed app.

This update merges application files into an existing installation. It contains no user settings, logs or API keys.
