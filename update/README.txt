Monkeyeffect online update pack v1.3.0

Feed: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json
Zip: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/Monkeyeffect-1.3.0-update.zip
SHA256: 9a20fcb3d7460ff2696deb9f14174c8a4762fdeea33187908f65a9337984a687

Changes:
- Preserve incoming chat in a full event history so built-in TTS continues receiving messages after prolonged use.
- Restore Subathon rule creation, editing, deletion, testing and persistence; support named gift additions and deductions.
- Remove the four-hour Subathon ceiling and allow continued accumulation beyond 24 hours without integer overflow.
- Preserve the active timer deadline across application restarts.
- Include the Sultan sizing and video queue fixes from 1.2.9.

Validation:
- Reproduced the lost-chat defect with 400 gift events; the fix retained 1,000 new chats following 5,000 mixed events.
- Production frontend TTS processed 25 of 25 chats through actual local free playback with no duplicates.
- Three free voice playback checks passed while the main application was minimized.
- Subathon CRUD, persistence, gift combo deduplication, concurrent additions, subtraction, long durations and restart restoration passed.
- Every update file matches the verified setup payload except the explicit 1.3.0 version markers; ZIP extraction hashes verified.

This cumulative update contains no user settings, logs or API keys.
Validation covers local application behavior; live TikTok network delivery was not exercised.
