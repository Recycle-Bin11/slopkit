# Audited WebKit Autoloader installer v0.3.1

This directory provides the corresponding source provenance and the complete
local modifications for `payloads/webkit-autoloader-installer_v0.3.1.elf`.
The ELF is a modified build and is not an official itsPLK release binary.

## Binary

- Size: 1,983,744 bytes
- SHA-256: `D71CD07E8EA0C8F8D7CC78C27535F699212183B1B48B7477F7B41F03D3E23EED`
- Target: PS5, ELF64 x86-64 PIE

The installer contains the audited unified autoloader with SHA-256
`AED9D4696471FC3679D2016BC73208BC7701BDA53F38300520A5E72CB02A2D2A`.
That autoloader contains the audited Payload Manager with SHA-256
`9924A20DD8F495961576B71D7139444FC9466A1E0D82325D1E8024E748743003`.
Both nested files were extracted after the final build and compared byte for
byte with the inputs that were reviewed before embedding.

## Pinned source revisions

- [ps5-webkit-autoloader](https://github.com/itsPLK/ps5-webkit-autoloader/tree/3e9b02d49fedc54a26c66613a153df3b2e9909c2): `3e9b02d49fedc54a26c66613a153df3b2e9909c2`
- [ps5-unified-autoloader](https://github.com/itsPLK/ps5-unified-autoloader/tree/955249d4c895ab1e9b7ae74e809da48e56a3f37c): `955249d4c895ab1e9b7ae74e809da48e56a3f37c`
- [ps5-payload-manager](https://github.com/itsPLK/ps5-payload-manager/tree/eaa2d0a8842719cbcbec9c1b8ff708d7480c9f60): `eaa2d0a8842719cbcbec9c1b8ff708d7480c9f60`
- [slopkit](https://github.com/jordyidk/slopkit/tree/6153152be0b6a69e7e7931ff1b68523b7fde1429): `6153152be0b6a69e7e7931ff1b68523b7fde1429`
- [umtx2](https://github.com/idlesauce/umtx2/tree/a080beb74d9e4bc34f3563798b716bd86b2d6ee0): `a080beb74d9e4bc34f3563798b716bd86b2d6ee0`
- [ps5-elfldr](https://github.com/ps5-payload-dev/elfldr/tree/148b71c2fb9155d2550ef6a14eb03433e23acaeb): `148b71c2fb9155d2550ef6a14eb03433e23acaeb`

Apply `patches/webkit-loopback.patch` to ps5-webkit-autoloader and
`patches/payload-manager-hardening.patch` to ps5-payload-manager before using
the upstream build procedure. The other pinned components are unmodified.

## Security-relevant differences

- The installer's temporary HTTP server listens only on `127.0.0.1`.
- Payload Manager does not refresh an external repository on startup.
- Manual remote downloads allow HTTPS only, keep certificate and hostname
  verification enabled, and require a matching SHA-256 for every ELF.
- The original insecure TLS fallback has been removed.

No telemetry, analytics, hidden command server, or automatic external request
was found in the reviewed installer/autoloader chain. Payload Manager still
intentionally exposes its unauthenticated management server on LAN port 8084;
use it only on a trusted local network.

## Reproduction environment

- PS5 Payload SDK v0.42
- LLVM 18.1.8
- libmicrohttpd 1.0.1
- mbedTLS 3.6.0
- curl 8.18.0

The curl source archive was checked using Daniel Stenberg's signing key,
fingerprint `27ED EAF2 2F3A BCEB 50DB 9A12 5CC9 08FD B71E 12C2`.

This modified build is distributed under GPL-3.0; see `LICENSE`. Upstream
copyright remains with the respective authors.
