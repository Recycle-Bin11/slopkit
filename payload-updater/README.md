# Payload updater

`payload-updater.elf` downloads the current repository copies of:

- `ftpsrv-ps5.elf`
- `kstuff.elf`
- `shadowmountplus.elf`

Each file is downloaded to a `.part` file, checked for ELF magic, exact size and
SHA-256, and then atomically moved into `/data/pldmgr/payloads`. Files not listed
in `payloads-manifest.json` are never deleted or modified.

The manifest header is generated during the build from the actual files under
`../payloads`, so replacing one of those files requires rebuilding the updater.
The GitHub Actions workflow performs this rebuild automatically.

## Build

With the PS5 Payload SDK at `/opt/ps5-payload-sdk` and a current CA bundle at
`assets/cacert.pem`:

```sh
make -C payload-updater
```

The updater reuses the GPLv3 SHA-256 and libcurl approach from
`itsPLK/ps5-payload-manager`. The updater source is licensed under
GPL-3.0-or-later.
