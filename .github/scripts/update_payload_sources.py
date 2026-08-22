#!/usr/bin/env python3
"""Download approved PS5 release assets and replace matching repo payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import urllib.parse
import urllib.request


MAX_ELF_SIZE = 4 * 1024 * 1024
MIN_ELF_SIZE = 4096
ALLOWED_FINAL_HOSTS = {
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}


def read_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    payloads = data.get("payloads")
    if not isinstance(payloads, dict) or not payloads:
        raise ValueError("payload source configuration is empty")
    return payloads


def download(url: str) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "github.com":
        raise ValueError(f"unapproved source URL: {url}")

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Recycle-Bin11-slopkit-payload-updater"},
    )
    chunks: list[bytes] = []
    total = 0
    with urllib.request.urlopen(request, timeout=90) as response:
        final = urllib.parse.urlparse(response.geturl())
        if final.scheme != "https" or final.hostname not in ALLOWED_FINAL_HOSTS:
            raise ValueError(f"unapproved download redirect: {response.geturl()}")
        while True:
            chunk = response.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_ELF_SIZE:
                raise ValueError(f"download exceeds {MAX_ELF_SIZE} bytes")
            chunks.append(chunk)
    return b"".join(chunks)


def validate_elf(data: bytes, name: str) -> None:
    if not MIN_ELF_SIZE <= len(data) <= MAX_ELF_SIZE:
        raise ValueError(f"{name}: unexpected size {len(data)}")
    if data[:4] != b"\x7fELF":
        raise ValueError(f"{name}: missing ELF magic")
    if data[4:6] != b"\x02\x01":
        raise ValueError(f"{name}: expected a 64-bit little-endian ELF")
    if len(data) < 20 or struct.unpack_from("<H", data, 18)[0] != 0x3E:
        raise ValueError(f"{name}: expected an x86-64 ELF")


def replace_file(target: Path, data: bytes) -> bool:
    if target.exists() and target.read_bytes() == data:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    try:
        with partial.open("wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)
    return True


def update_payload(repo: Path, payload_id: str, entry: dict, channel: str) -> bool:
    target = repo / entry["target"]
    pinned = entry["pinned"]
    url = pinned["url"] if channel == "pinned" else entry["latest_url"]
    data = download(url)
    validate_elf(data, target.name)
    digest = hashlib.sha256(data).hexdigest()

    if channel == "pinned":
        if len(data) != pinned["size"]:
            raise ValueError(
                f"{target.name}: expected {pinned['size']} bytes, got {len(data)}"
            )
        if digest != pinned["sha256"]:
            raise ValueError(f"{target.name}: pinned SHA-256 mismatch")

    changed = replace_file(target, data)
    state = "updated" if changed else "already current"
    print(f"{payload_id}: {state}; {len(data)} bytes; sha256={digest}")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--channel", choices=("pinned", "latest"), required=True)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument(
        "--config", type=Path, default=Path(".github/payload-sources.json")
    )
    args = parser.parse_args()

    repo = args.repo.resolve()
    config_path = args.config
    if not config_path.is_absolute():
        config_path = repo / config_path
    payloads = read_config(config_path)

    selected = list(payloads) if args.payload == "all" else [args.payload]
    unknown = [payload_id for payload_id in selected if payload_id not in payloads]
    if unknown:
        raise ValueError(f"unknown payload selection: {', '.join(unknown)}")

    changed = sum(
        update_payload(repo, payload_id, payloads[payload_id], args.channel)
        for payload_id in selected
    )
    print(f"complete: {changed} payload(s) changed")


if __name__ == "__main__":
    main()
