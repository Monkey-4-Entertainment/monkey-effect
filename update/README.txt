Monkeyeffect online update pack v1.2.9

Feed: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json
Zip: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/Monkeyeffect-1.2.9-update.zip
SHA256: 854857577c11e0aab8da44dfb725a94c172d855b7b73145549d1a0c7b431face

Changes:
- Resize Sultan ranks 1, 2 and 3 independently (50-150%) with saved positions and separate live/all layouts.
- Restore the video compositor canvas so the overlay initializes and plays instead of remaining green.
- Identify each playback command and deduplicate BroadcastChannel, storage and HTTP deliveries, including retries.
- Match completion to the current playback command; ignore stale status and tolerate clips shorter than a polling interval.
- Correct overlapping gift credits, retain counts above 500, and let long active clips finish without the former 120-second cutoff.
- Cancel pending file/audio work when stopped; queue previews and retain pending jobs when the overlay is unavailable.
- Includes the existing 1.2.8 Paxa and built-in TTS fixes.

Validation:
- Regression suite reproduced the original triple start, 501-to-500 truncation, and 2-to-3 overlapping-gift overcount.
- 30 requested plays produced 30 completions with all three transports and with HTTP alone.
- Five accelerated real-video runs produced five loads, starts and completions with no JavaScript errors.
- Cancellation, stale status, missing-file continuation, long playback, retry identity and delayed commands passed.
- Updated app verified through its native Test button; Setup installation and all 2,559 payload hashes verified.

This update merges application files into an existing installation and includes no user settings, logs or API keys.
Tests cover the local video pipeline; upstream TikTok/network delivery is not guaranteed by these tests.
