Monkeyeffect online update pack v1.2.8

Feed: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json
Zip: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/Monkeyeffect-1.2.8-update.zip
SHA256: 135b76a9200a1f4ffea86a179ce671f70050e6fad360f8f933d969d0ecbc5346

Changes:
- Fix dialect conversion HTTP 400 by omitting do_not_translate when no protected names are present.
- Show safe provider error codes and distinguish translation failures from speech synthesis failures.
- Regression tests pass; live Northern Thai conversion and native audio playback verified through the installed application.
- Fix Paxa API key validation: call the documented GET /v1/me instead of the nonexistent /v1/account.
- Distinguish invalid/disabled keys from rate limits and service failures; preserve prior keys on failed validation.
- Ten isolated validation tests pass, including valid accounts with zero credit and malformed success responses.
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
