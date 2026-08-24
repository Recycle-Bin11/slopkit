# Garlic SaveMgr v1.7 audit record

This repository includes the unmodified `garlic-savemgr.elf` release asset from:

- Upstream: https://github.com/earthonion/garlic-savemgr
- Tag: `v1.7`
- Commit: `febd30a39b756e93fcd7a6a0c9374bfb40602c71`
- Release asset SHA-256: `124051ab3a762474720ae53187d2920bc96d6be1d69aa298e715667efc385a2f`
- GitHub asset digest: `sha256:124051ab3a762474720ae53187d2920bc96d6be1d69aa298e715667efc385a2f`

## Review summary

- Native networking is an inbound HTTP server bound to all interfaces on TCP port 8082.
- No native outbound connection call, telemetry endpoint, downloader, shell execution, or dynamically loaded extension was found in the reviewed application source.
- The embedded web UI uses same-origin `/api/...` requests.
- The UI contains one external GitHub Sponsors iframe. It is created only after the user confirms shutdown; it is not automatic at payload startup.
- The release ELF imports `libSceNet` and the server-side `socket` API, consistent with its documented local web server.
- The server has no authentication and provides privileged save-management operations. It should only be used on a trusted local network and stopped when no longer needed.

This is a static source and binary review, not a guarantee that the software is free of every possible vulnerability.
