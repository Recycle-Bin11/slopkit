# PS5 autoload editor

Choose **Editar autoload** directly below **Payloads (sender)** in the main menu.
The editor reads **/data/ps5_autoloader/autoload.txt inside the console**.

- Select payloads from the hosted catalog to add them at the end.
- Uncheck a payload (or use Quitar) to remove every selected occurrence with the checkbox, or just one occurrence with Quitar.
- Add a wait, change its duration in milliseconds, and move any step with the arrow buttons.
- Save explicitly with Guardar en PS5. Closing discards unsaved changes.
- Leer desde PS5 reloads the live TXT and discards local edits.
- Descargar TXT exports the preview only; it does not write to the PS5.

Selecting new payloads copies the repository ELF into **/data/ps5_autoloader/** on save.
Deselecting a previously configured payload deletes that ELF **from that same directory only**, after the new TXT has been verified. Payloads already in the TXT remain available even if absent from the repository catalog. Existing directives and unusual paths are preserved as special lines; they cannot be deleted in this editor.

## Save behavior

1. Reject a stale edit if the current PS5 TXT differs from the last read.
2. Create and verify a uniquely named autoload.txt.bak-TIMESTAMP-RANDOM backup.
3. Download new payloads from the hosted same-origin payload directory, validate ELF64 little-endian x86-64 headers and the 4 MiB limit, write temporary files, fsync and read back byte-for-byte before renaming.
4. Stage and verify the TXT, recheck the baseline, then rename over autoload.txt and read it again.
5. Delete only safe filenames removed from the previous sequence, after verification. Deletion errors are reported as warnings.

An interrupted save before the TXT rename keeps the old configuration but may leave newly copied payloads or a backup. An error after the rename is reported as already committed; reload before trying again. The backup stores the previous TXT, not copies of deleted payload binaries. Restore it manually with FTP if necessary and reinstall any missing payloads.

Existing payloads kept in the sequence are not redownloaded or replaced. A selected payload that is removed and reselected before saving is still considered unchanged. Existing ELF files not referenced by the TXT are never removed by this editor.

## Runtime and limits

The page automatically sends the dedicated autoload-editor-helper.elf to the local ELF loader (9021). That native process reads and writes the files; ftpsrv is not required. It listens only on 127.0.0.1:9025, accepts one session and closes when the editor disconnects or after 15 minutes of inactivity. The helper restricts operations to an opened /data/ps5_autoloader directory, uses O_NOFOLLOW and exclusive staging/backup creation, and never executes payloads or changes credentials. See [helper source and build](../autoload-helper/README.md).

An existing autoload.txt, jailbreak, an active ELF loader and sufficient native /data permissions are required. The page locks the shared syscall sender while the editor is open. If the native helper cannot open the directory, its actual errno is displayed. No success is reported until the saved TXT has been read back.

!500 means 500 ms. Supported edited waits: 0–3600000 ms, up to 256 steps and 64 KiB of text. Simple relative ASCII ELF names are editable; unusual existing lines are retained literally. No payload is executed by saving: the new sequence is for the next autoloader run. USB and title-specific configurations may take priority over this /data configuration.

## Verification

The CI test uses an in-memory filesystem and a simulated syscall runtime to cover the supplied sequence, CRLF, delays, scoped paths, ELF validation, backups, stale edits, failures before commit, cleanup warnings, special-line preservation, partial reads/writes and fd closure. Syntax checks include the full inline page module.

This has not been tested on real PS5 hardware. The original jailbreak implementation is unchanged; only the editor integration and file operations were added.


## Native helper (v3)

The old direct-syscall/FTP fallback is superseded by the native helper. Generic socket transport remains in autoload-ftp.js, but opening the editor no longer connects to FTP.

CI compiles the PS5 ELF with the pinned official SDK and tests the actual C server against the JavaScript client on Linux, including the supplied sequence, backups, byte-for-byte ELF copying, deletion, session restart, staging collisions and symlink refusal. The source commit and ELF hash are recorded in autoload-helper/build.json. Console loading, file permissions and first-open text rendering still require hardware verification.

The PS5 modal uses an opaque background, explicit WebKit text colors and a layout/animation-frame repaint before file I/O.
