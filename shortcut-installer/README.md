# Web Browser shortcut installer

`web-browser-installer.elf` installs a PS5 home-screen shortcut named
**Web Browser**. Opening it launches:

`https://recycle-bin11.github.io/slopkit/`

The internal title ID is `SLOP00001`. Run the ELF once through an existing PS5
ELF loader. Running it again reinstalls the shortcut and refreshes its metadata.

## Build

With the PS5 Payload SDK installed at `/opt/ps5-payload-sdk`:

```sh
make -C shortcut-installer
```

The implementation is derived from the GPLv3 app installers in
`itsPLK/ps5-payload-manager` and `ps5-payload-dev/ftpsrv`; redistribution and
modification are governed by GPLv3.
