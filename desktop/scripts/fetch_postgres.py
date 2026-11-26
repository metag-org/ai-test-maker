#!/usr/bin/env python3
"""Download and extract relocatable embedded PostgreSQL binaries for macOS / Windows.

Uses Zonky's official embedded-postgres-binaries hosted on Maven Central
(Apache 2.0 packaging of official PostgreSQL binaries under the PostgreSQL License).
"""

from __future__ import annotations

import argparse
import io
import os
import platform
import shutil
import stat
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_PG_VERSION = "16.16.0"

PLATFORM_ARTIFACTS = {
    "darwin-arm64": "embedded-postgres-binaries-darwin-arm64v8",
    "darwin-x64": "embedded-postgres-binaries-darwin-amd64",
    "windows-x64": "embedded-postgres-binaries-windows-amd64",
    "linux-x64": "embedded-postgres-binaries-linux-amd64",
}

# Keep only the essential binaries needed by the desktop app to minimize installer size
KEEP_BINARIES = {
    "postgres",
    "initdb",
    "pg_ctl",
    "pg_isready",
    "psql",
    "createdb",
    "pg_dump",
    "pg_restore",
}


def detect_target_platform() -> str:
    sys_name = platform.system().lower()
    machine = platform.machine().lower()
    if sys_name == "darwin":
        return "darwin-arm64" if machine in ("arm64", "aarch64") else "darwin-x64"
    if sys_name == "windows":
        return "windows-x64"
    if sys_name == "linux":
        return "linux-x64"
    raise RuntimeError(f"Unsupported platform: {sys_name} / {machine}")


def download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size > 1_000_000:
        print(f"Using cached archive: {dest}")
        return
    print(f"Downloading {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "ReviewTestMaker-Builder/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"Downloaded {dest.name} ({size_mb:.1f} MB)")


def prune_postgres_dir(target_dir: Path, is_windows: bool) -> None:
    """Remove docs, headers, and unused CLI tools to shrink installer size."""
    for folder in ("doc", "include", "man", "pgAdmin 4", "StackBuilder"):
        p = target_dir / folder
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)

    # Trim extra CLI executables in bin/ while keeping all DLLs / shared libs
    bin_dir = target_dir / "bin"
    if bin_dir.is_dir():
        for item in bin_dir.iterdir():
            if not item.is_file():
                continue
            if is_windows:
                if item.suffix.lower() == ".exe" and item.stem.lower() not in KEEP_BINARIES:
                    item.unlink(missing_ok=True)
            else:
                if item.name not in KEEP_BINARIES and not item.name.endswith((".dylib", ".so")):
                    item.unlink(missing_ok=True)


def extract_jar_to_dir(jar_path: Path, output_dir: Path, is_windows: bool) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(jar_path, "r") as zf:
        txz_members = [m for m in zf.namelist() if m.endswith(".txz")]
        if not txz_members:
            raise RuntimeError(f"No .txz PostgreSQL archive found inside {jar_path}")
        txz_name = txz_members[0]
        print(f"Extracting {txz_name} -> {output_dir} ...")
        txz_bytes = zf.read(txz_name)

    with tarfile.open(fileobj=io.BytesIO(txz_bytes), mode="r:xz") as tf:
        try:
            tf.extractall(path=output_dir, filter="tar")
        except TypeError:
            tf.extractall(path=output_dir)

    prune_postgres_dir(output_dir, is_windows=is_windows)

    # Ensure executables have +x on POSIX
    if not is_windows:
        bin_dir = output_dir / "bin"
        if bin_dir.is_dir():
            for item in bin_dir.iterdir():
                if item.is_file():
                    item.chmod(item.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch portable embedded PostgreSQL binaries")
    parser.add_argument(
        "--platform",
        choices=sorted(PLATFORM_ARTIFACTS.keys()),
        default=None,
        help="Target platform (default: auto-detect host)",
    )
    parser.add_argument(
        "--version",
        default=DEFAULT_PG_VERSION,
        help=f"PostgreSQL binary version (default: {DEFAULT_PG_VERSION})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "runtime" / "postgres",
        help="Output directory for extracted PostgreSQL runtime",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / ".cache",
        help="Download cache directory",
    )
    args = parser.parse_args(argv)

    target_platform = args.platform or detect_target_platform()
    artifact = PLATFORM_ARTIFACTS[target_platform]
    jar_name = f"{artifact}-{args.version}.jar"
    url = (
        f"https://repo1.maven.org/maven2/io/zonky/test/postgres/"
        f"{artifact}/{args.version}/{jar_name}"
    )

    jar_path = args.cache_dir / jar_name
    download_file(url, jar_path)
    extract_jar_to_dir(jar_path, args.output, is_windows=target_platform.startswith("windows"))

    # Quick sanity check
    exe = args.output / "bin" / ("postgres.exe" if target_platform.startswith("windows") else "postgres")
    if not exe.is_file():
        raise FileNotFoundError(f"Expected PostgreSQL binary missing after extraction: {exe}")

    total_bytes = sum(p.stat().st_size for p in args.output.rglob("*") if p.is_file())
    print(f"Ready: {args.output} ({total_bytes / (1024 * 1024):.1f} MB uncompressed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
