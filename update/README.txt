Monkeyeffect 1.3.2.1 - update installation repair

Update ZIP: https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/Monkeyeffect-1.3.2.1-update.zip
SHA256: a5c33240b8b4355832f4caebcdec9aa6a239a7d7fc0456d7ef3d3dcfdd5cd083

Includes TempleGiftRelay.exe, its dependency/runtime manifests, and the 1.3.2 features. The updater now preserves Unicode paths, verifies copied files, backs up changed files, restores files after a failed copy, and retains a useful failure log. It stops only the application process that requested the update.
The previous updater could continue after a copy failure and wrote installation paths using ASCII. These defects are fixed; they do not establish the reason for every reported missing EXE.

Existing installations can use the update. Machines that cannot launch must run a full Setup into their existing installation folder. An update ZIP is not a full installation and does not replace the Windows runtime bundle. User settings and media are excluded from this update.
Validation: 12 isolated updater checks passed, including Unicode paths, missing EXE recovery, copy failure rollback and process identity. Full Setup installation, file hashes and preservation of user files verified separately. ZIP extraction and all 235 file hashes verified.
