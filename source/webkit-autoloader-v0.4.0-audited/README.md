# Audited WebKit Autoloader installer v0.4.0

This directory records the exact source provenance and complete local runtime
modifications for `payloads/webkit-autoloader-installer_v0.4.0-audited.elf`.
The ELF is a modified build and is not an official itsPLK release binary.

## Binary

- Size: 2,164,032 bytes
- SHA-256: `6401B7B004A376107DDB5B12E4DA6AC41F755B1565509987DCDCBD03C4F47DC5`
- Version embedded in the app and cache path: `0.4.0` (stable)
- Target: PS5, ELF64 x86-64 PIE

The final installer contains these byte-for-byte verified nested binaries:

- audited unified autoloader: `AED9D4696471FC3679D2016BC73208BC7701BDA53F38300520A5E72CB02A2D2A`
- audited Payload Manager inside it: `9924A20DD8F495961576B71D7139444FC9466A1E0D82325D1E8024E748743003`
- shared elfldr: `6BF3A5416C84305F4E62CC952861F810806EB6613A3D24C4B35F947F2650BA33`
- umtx2's own bundled elfldr: `CC67181843AFC56B33421468D4C3610942F150C6BEBF0107C663C36918B63AF0`
- Poops/P2JB kexp: `46A5CD6BDF92B37AA09F512E05C2229DE1F0F2E7E7A7E60140A288F4CC15B7B6`

The raw-DEFLATE representations of the unified autoloader, shared elfldr,
modified `app.js`, modified `style.css`, patched Poops/P2JB pages, and patched
UMTX2 `main.js` were each found exactly once in the final ELF. This verifies
the reviewed inputs are the files embedded by the file registry, rather than
merely files left beside the build output.

## Pinned source revisions

- [ps5-webkit-autoloader](https://github.com/itsPLK/ps5-webkit-autoloader/tree/137f065d2ba8022ba8e796895e7cb05c204f2ce9): `137f065d2ba8022ba8e796895e7cb05c204f2ce9`
- [itsPLK/slopkit](https://github.com/itsPLK/slopkit/tree/e69a21762f8d12479443502ce19ea4a575295c48): `e69a21762f8d12479443502ce19ea4a575295c48`
- [ps5-unified-autoloader](https://github.com/itsPLK/ps5-unified-autoloader/tree/955249d4c895ab1e9b7ae74e809da48e56a3f37c): `955249d4c895ab1e9b7ae74e809da48e56a3f37c`
- [ps5-payload-manager](https://github.com/itsPLK/ps5-payload-manager/tree/eaa2d0a8842719cbcbec9c1b8ff708d7480c9f60): `eaa2d0a8842719cbcbec9c1b8ff708d7480c9f60`
- [umtx2](https://github.com/idlesauce/umtx2/tree/a080beb74d9e4bc34f3563798b716bd86b2d6ee0): `a080beb74d9e4bc34f3563798b716bd86b2d6ee0`
- [itsPLK/ps5-elfldr](https://github.com/itsPLK/ps5-elfldr/tree/148b71c2fb9155d2550ef6a14eb03433e23acaeb): `148b71c2fb9155d2550ef6a14eb03433e23acaeb`

Downloaded commit archives were pinned and hashed before the build:

- ps5-webkit-autoloader: `F119E2B8C38741E2700B1CF55C0A1B32D292AD95C24FAF3D3A106692365A5C1C`
- slopkit: `0025ECBE5298E2B613E00B019A25108AAB565E92C805865C2793BAAEC30BE619`
- unified autoloader: `D2B48988796FF0364218F6D3F6CD4FBBEC216E5BB5BCA9FD3611892866881FBC`
- umtx2: `98E38F814041AC5A97B4F5D6896B6E58169CDBE7C272F3284DBEF26160676DD2`
- ps5-elfldr: `54087960FC433C576E29DC0F0A7EB6A581C8F556BA869D13E3F958956E525B83`

Apply all patches in `patches/` before following the upstream build procedure.
`payload-manager-hardening.patch` is applied when rebuilding the nested Payload
Manager; the resulting previously audited unified-autoloader ELF is then pinned
by its SHA-256 and embedded without any network download during this build.

## Firmware routing and Poopsploit stability

The host selects exactly one exploit page from the detected firmware string:

- umtx2: 1.00-5.50
- Poopsploit: 7.00-12.00
- P2JB: 12.02-12.70

P2JB is never loaded or executed on a firmware routed to Poopsploit, so merely
including P2JB does not add concurrent P2JB work to a Poops run. However, v0.4.0
also updates Poopsploit itself: Stage 5 now loads `kexp-v0.7-b12c352.bin` and
passes a 12-entry API table instead of patching the older shellcode in memory.
Therefore no claim is made that Poopsploit is byte-for-byte or behaviorally
identical to v0.3.1. Those upstream exploit changes were kept unmodified and
must be stability-tested on real PS5 hardware.

## Security-relevant differences and findings

- The temporary installer HTTP server is explicitly bound to `127.0.0.1`.
- Payload Manager does not refresh an external repository on startup.
- Manual remote downloads allow HTTPS only, keep certificate and hostname
  verification enabled, and require a matching SHA-256 for every ELF.
- The original insecure TLS fallback remains removed.
- Runtime fetches used by Poops, P2JB and umtx2 are relative/local resources.
- Poops/P2JB diagnostic POSTs target the same-origin relative path
  `/__poops_log`; in the installed app that origin is the console's loopback
  server. No external telemetry or analytics endpoint was found.
- P2JB adds no automatic external connection. External URLs retained in some
  source pages are attribution links and are not automatically requested.
- Success now fills the progress bar green; terminal errors fill it red.
  Matching log messages use higher-contrast backgrounds and borders.
- When elfldr already owns port 9021, Poops, P2JB and UMTX2 now report
  `Already Jailbroken!` to the parent app and stop without re-running the
  kernel exploit or autoloading the bundled payload. A fresh jailbreak still
  autoloads the bundled payload exactly once.

Payload Manager still intentionally exposes its unauthenticated management
server on LAN port 8084. elfldr intentionally accepts payloads on port 9021 and
can process a URI supplied by a client. These are documented product functions,
not automatic outbound traffic; use them only on a trusted local network.

This is a static source/build audit, not proof that an exploit cannot panic or
that reviewed source contains no vulnerability. Real-console testing is still
required, especially because v0.4.0 changes Poopsploit Stage 5.

## Reproduction environment

- PS5 Payload SDK v0.42 (`8CFBC7CD5811E719EB4F0C47EEA668D3DC7B40BC8AB11C4A5031D40C23EC02DA`)
- LLVM 18.1.8
- libmicrohttpd 1.0.1 (`A89E09FC9B4DE34DDE19F4FCB4FAAA1CE10299B9908DB1132BBFA1DE47882B94`)
- mbedTLS 3.6.0
- curl 8.18.0

The curl source archive used for the nested Payload Manager was checked using
Daniel Stenberg's signing key, fingerprint
`27ED EAF2 2F3A BCEB 50DB 9A12 5CC9 08FD B71E 12C2`.

This modified build is distributed under GPL-3.0; see `LICENSE`. Upstream
copyright remains with the respective authors.
