#!/usr/bin/env python3
"""Validate updater inputs and generate the compile-time payload manifest."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath


REPO = "Recycle-Bin11/slopkit"
SAFE_TARGET = re.compile(r"^[A-Za-z0-9._-]+\.elf$")
SAFE_REF = re.compile(r"^(?:main|[0-9a-f]{40})$")


def c_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"manifest error: {message}")


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: generate_manifest_header.py MANIFEST OUTPUT REPO_ROOT")

    manifest_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    repo_root = Path(sys.argv[3]).resolve()
    source_ref = os.environ.get("PAYLOAD_SOURCE_REF", "main")
    if not SAFE_REF.fullmatch(source_ref):
        fail("PAYLOAD_SOURCE_REF must be main or a full commit SHA")
    raw_prefix = f"https://raw.githubusercontent.com/{REPO}/{source_ref}/"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = data.get("payloads")
    if not isinstance(entries, list) or not entries:
        fail("payloads must be a non-empty array")

    generated: list[str] = []
    seen_targets: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            fail(f"entry {index} must be an object")
        source = entry.get("source")
        target = entry.get("target")
        if not isinstance(source, str) or not isinstance(target, str):
            fail(f"entry {index} requires string source and target")

        posix_source = PurePosixPath(source)
        if posix_source.is_absolute() or ".." in posix_source.parts:
            fail(f"unsafe source path: {source}")
        if len(posix_source.parts) != 2 or posix_source.parts[0] != "payloads":
            fail(f"source must be a direct file in payloads/: {source}")
        if not SAFE_TARGET.fullmatch(target):
            fail(f"unsafe target filename: {target}")
        if target in seen_targets:
            fail(f"duplicate target filename: {target}")
        seen_targets.add(target)

        source_path = repo_root.joinpath(*posix_source.parts).resolve()
        try:
            source_path.relative_to(repo_root)
        except ValueError:
            fail(f"source escapes repository: {source}")
        if not source_path.is_file():
            fail(f"source file does not exist: {source}")

        content = source_path.read_bytes()
        if len(content) < 4 or content[:4] != b"\x7fELF":
            fail(f"source is not an ELF: {source}")
        digest = hashlib.sha256(content).hexdigest()
        url = raw_prefix + source
        generated.append(
            "    { %s, %s, %s, %dULL, %s },"
            % (
                c_string(source),
                c_string(target),
                c_string(url),
                len(content),
                c_string(digest),
            )
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output = [
        "/* Generated from payloads-manifest.json. Do not edit manually. */",
        "#pragma once",
        "",
        "static const payload_update_t PAYLOAD_UPDATES[] = {",
        *generated,
        "};",
        "",
        "#define PAYLOAD_UPDATE_COUNT \\",
        "  (sizeof(PAYLOAD_UPDATES) / sizeof(PAYLOAD_UPDATES[0]))",
        "",
    ]
    output_path.write_text("\n".join(output), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
