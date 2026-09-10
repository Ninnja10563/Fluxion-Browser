#!/usr/bin/env python3
"""Install an exact local chrome override, leaving Gecko's archive untouched."""

import os
from pathlib import Path
from contextlib import contextmanager
import shutil
import struct
import sys
import tempfile
import zipfile

ENTRY = "chrome/browser/content/browser/default-bookmarks.html"
MANIFEST = "override chrome://browser/content/default-bookmarks.html default-bookmarks.html\n"
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_DIRECTORY = 32 * 1024 * 1024


@contextmanager
def readable_archive(archive):
    # Mozilla JarWriter puts its directory at byte 4, followed by an EOCD,
    # local records, and a duplicate EOCD. Python assumes a directory adjacent
    # to the final EOCD and otherwise invents a wrong concatenation offset.
    # Append a standard directory/footer to a private temporary VIEW only.
    # Local offsets and compressed bytes remain unchanged; zipfile still
    # validates member names, overlapping records, decompression and CRC.
    with open(archive, "rb") as original:
        size = os.fstat(original.fileno()).st_size
        if size < 22 or size > MAX_ARCHIVE:
            raise ValueError("Unsupported Gecko archive size")
        original.seek(max(0, size - 65557))
        tail = original.read(65557)
        position = tail.rfind(b"PK\x05\x06")
        if position < 0 or position + 22 > len(tail):
            raise ValueError("Missing Gecko archive footer")
        end = struct.unpack_from("<4s4H2IH", tail, position)
        if position + 22 + end[7] != len(tail):
            raise ValueError("Invalid Gecko archive footer bounds")
        if end[6] != 4:
            with zipfile.ZipFile(original) as source:
                yield source
            return
        if end[1] or end[2] or end[3] != end[4] or end[4] in (0, 65535) or end[7]:
            raise ValueError("Unsupported optimized Gecko archive footer")
        directory_size = end[5]
        local_start = 4 + directory_size + 22
        footer_start = size - 22
        if directory_size < end[4] * 46 or directory_size > MAX_DIRECTORY or local_start >= footer_start:
            raise ValueError("Invalid optimized Gecko directory bounds")
        original.seek(0)
        preload = struct.unpack("<I", original.read(4))[0]
        directory = original.read(directory_size)
        first_footer = original.read(22)
        if not directory.startswith(b"PK\x01\x02") or first_footer != tail[position:] or not local_start <= preload <= footer_start:
            raise ValueError("Invalid optimized Gecko directory or duplicate footer")
        with tempfile.TemporaryFile() as view:
            original.seek(0)
            shutil.copyfileobj(original, view, length=1024 * 1024)
            view.write(directory)
            replacement = list(end)
            replacement[6] = size
            view.write(struct.pack("<4s4H2IH", *replacement))
            view.seek(0)
            with zipfile.ZipFile(view) as source:
                if len(source.infolist()) != end[4] or any(
                    not local_start <= entry.header_offset < footer_start or
                    entry.compress_size > footer_start - entry.header_offset
                    for entry in source.infolist()
                ):
                    raise ValueError("Invalid optimized Gecko local record bounds")
                for entry in source.infolist():
                    original.seek(entry.header_offset)
                    header = original.read(30)
                    if len(header) != 30 or header[:4] != b"PK\x03\x04":
                        raise ValueError("Invalid optimized Gecko local header")
                    name_size, extra_size = struct.unpack_from("<HH", header, 26)
                    if entry.header_offset + 30 + name_size + extra_size + entry.compress_size > footer_start:
                        raise ValueError("Invalid optimized Gecko local data bounds")
                yield source


def install(resources, asset):
    resources = Path(resources)
    archive = resources / "browser" / "omni.ja"
    # Fail rather than silently shipping inherited defaults if upstream moves
    # this resource. Reading a symlinked Linux archive is safe; never rewrite it.
    with readable_archive(archive) as source:
        matches = [entry for entry in source.infolist() if entry.filename == ENTRY]
        if len(matches) != 1 or matches[0].is_dir():
            raise ValueError("Unsupported Gecko default-bookmarks resource layout")
        if matches[0].file_size > 1024 * 1024:
            raise ValueError("Unexpected Gecko default-bookmarks resource size")
        source.read(matches[0])  # Validate the selected entry's CRC as well.
    data = Path(asset).read_bytes()
    if not data or len(data) > 16384:
        raise ValueError("Invalid Fluxion default bookmark asset")
    destination = resources / "fluxion-defaults"
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise ValueError("Refusing a non-directory Fluxion defaults destination")
    destination.mkdir(mode=0o755, exist_ok=True)
    for name, contents in (("default-bookmarks.html", data), ("chrome.manifest", MANIFEST.encode("utf-8"))):
        target = destination / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError("Refusing a non-regular Fluxion defaults file")
        descriptor, temporary = tempfile.mkstemp(prefix=".fluxion-default-", dir=destination)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(contents)
            os.chmod(temporary, 0o644)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: install-default-bookmarks.py RUNTIME_RESOURCES BOOKMARK_ASSET")
    try:
        install(*sys.argv[1:])
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        sys.exit(f"Fluxion default bookmarks: {error}")
