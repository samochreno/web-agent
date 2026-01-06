#!/usr/bin/env python3
"""Deterministically package frontend/dist into backend/frontend_dist.tar.gz."""

from __future__ import annotations

import tarfile
from pathlib import Path

REPRODUCIBLE_MTIME = 1704067200  # 2024-01-01 UTC


def collect_entries(frontend_dist: Path) -> list[Path]:
    entries = [frontend_dist]
    entries.extend(sorted(frontend_dist.rglob("*")))
    return entries


def add_entry(tar: tarfile.TarFile, path: Path, arcname: str) -> None:
    info = tarfile.TarInfo(arcname)
    info.mtime = REPRODUCIBLE_MTIME
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    if path.is_dir():
        if not arcname.endswith("/"):
            arcname = arcname + "/"
            info = tarfile.TarInfo(arcname)
            info.mtime = REPRODUCIBLE_MTIME
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
        info.mode = 0o755
        tar.addfile(info)
    else:
        info.size = path.stat().st_size
        info.mode = 0o644
        with path.open("rb") as fileobj:
            tar.addfile(info, fileobj)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    frontend_dist = repo_root / "frontend" / "dist"
    if not frontend_dist.is_dir():
        raise SystemExit(f"Missing frontend dist at {frontend_dist}")
    tarball_path = repo_root / "backend" / "frontend_dist.tar.gz"
    tarball_path.parent.mkdir(parents=True, exist_ok=True)
    if tarball_path.exists():
        tarball_path.unlink()

    with tarfile.open(tarball_path, "w:gz") as tar:
        for entry in collect_entries(frontend_dist):
            arcname = str(entry.relative_to(frontend_dist.parent)).replace("\\", "/")
            add_entry(tar, entry, arcname)


if __name__ == "__main__":
    main()
