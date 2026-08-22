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
MAX_METADATA_SIZE = 2 * 1024 * 1024
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


def read_release(entry: dict, channel: str) -> tuple[str, str, int, str]:
    repository = entry["repository"]
    if repository.count("/") != 1 or any(
        part in {"", ".", ".."} for part in repository.split("/")
    ):
        raise ValueError(f"invalid approved repository: {repository}")

    repository_request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "Recycle-Bin11-slopkit-payload-updater",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(repository_request, timeout=45) as response:
        if urllib.parse.urlparse(response.geturl()).hostname != "api.github.com":
            raise ValueError("unapproved GitHub repository API redirect")
        repository_metadata = response.read(MAX_METADATA_SIZE + 1)
    if len(repository_metadata) > MAX_METADATA_SIZE:
        raise ValueError("GitHub repository metadata is unexpectedly large")
    github_repository = json.loads(repository_metadata)
    repository_checks = {
        "full name": (github_repository.get("full_name"), repository),
        "repository ID": (github_repository.get("id"), entry["repository_id"]),
        "owner ID": (
            github_repository.get("owner", {}).get("id"),
            entry["owner_id"],
        ),
    }
    for label, (actual, expected) in repository_checks.items():
        if actual != expected:
            raise ValueError(
                f"{repository}: approved {label} changed "
                f"({actual!r} != {expected!r})"
            )

    if channel == "pinned":
        tag = urllib.parse.quote(entry["pinned"]["tag"], safe="")
        endpoint = f"releases/tags/{tag}"
    else:
        endpoint = "releases/latest"
    api_url = f"https://api.github.com/repos/{repository}/{endpoint}"
    request = urllib.request.Request(
        api_url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "Recycle-Bin11-slopkit-payload-updater",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        if urllib.parse.urlparse(response.geturl()).hostname != "api.github.com":
            raise ValueError("unapproved GitHub API redirect")
        metadata = response.read(MAX_METADATA_SIZE + 1)
    if len(metadata) > MAX_METADATA_SIZE:
        raise ValueError("GitHub release metadata is unexpectedly large")
    release = json.loads(metadata)

    assets = [asset for asset in release.get("assets", []) if asset.get("name") == entry["asset"]]
    if len(assets) != 1:
        raise ValueError(
            f"{repository}: expected exactly one release asset named {entry['asset']}"
        )
    asset = assets[0]
    uploader = asset.get("uploader", {}).get("login")
    if uploader not in entry["allowed_uploaders"]:
        raise ValueError(f"{entry['asset']}: unapproved uploader {uploader!r}")

    digest = asset.get("digest", "")
    if not digest.startswith("sha256:") or len(digest) != 71:
        raise ValueError(f"{entry['asset']}: GitHub did not provide a SHA-256 digest")
    digest = digest.removeprefix("sha256:").lower()
    try:
        bytes.fromhex(digest)
    except ValueError as error:
        raise ValueError(f"{entry['asset']}: invalid GitHub digest") from error

    url = asset.get("browser_download_url", "")
    expected_prefix = f"https://github.com/{repository}/releases/download/"
    if not url.startswith(expected_prefix) or not url.endswith("/" + entry["asset"]):
        raise ValueError(f"{entry['asset']}: unexpected release download URL")

    if channel == "pinned":
        pinned = entry["pinned"]
        checks = {
            "release ID": (release.get("id"), pinned["release_id"]),
            "release tag": (release.get("tag_name"), pinned["tag"]),
            "asset ID": (asset.get("id"), pinned["asset_id"]),
            "asset URL": (url, pinned["url"]),
            "asset size": (asset.get("size"), pinned["size"]),
            "asset digest": (digest, pinned["sha256"]),
        }
        for label, (actual, expected) in checks.items():
            if actual != expected:
                raise ValueError(
                    f"{entry['asset']}: pinned {label} changed "
                    f"({actual!r} != {expected!r})"
                )

    return url, digest, int(asset["size"]), str(release["tag_name"])


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
    url, github_digest, github_size, tag = read_release(entry, channel)
    data = download(url)
    validate_elf(data, target.name)
    digest = hashlib.sha256(data).hexdigest()

    if len(data) != github_size:
        raise ValueError(
            f"{target.name}: GitHub reported {github_size} bytes, got {len(data)}"
        )
    if digest != github_digest:
        raise ValueError(f"{target.name}: downloaded bytes do not match GitHub digest")

    if channel == "pinned":
        if len(data) != pinned["size"]:
            raise ValueError(
                f"{target.name}: expected {pinned['size']} bytes, got {len(data)}"
            )
        if digest != pinned["sha256"]:
            raise ValueError(f"{target.name}: pinned SHA-256 mismatch")

    changed = replace_file(target, data)
    state = "updated" if changed else "already current"
    print(
        f"{payload_id}: {state}; tag={tag}; {len(data)} bytes; "
        f"sha256={digest}; source={entry['repository']}"
    )
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
