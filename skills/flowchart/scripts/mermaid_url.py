#!/usr/bin/env python3
"""Generate a Mermaid Live edit URL from UTF-8 Mermaid source; no network or browser side effects."""
import argparse
import base64
import json
from pathlib import Path
import sys
import zlib


def make_url(code: str) -> str:
    if not code.strip():
        raise ValueError("Mermaid source must not be empty")
    state = {
        "code": code,
        "mermaid": json.dumps({"theme": "default"}, separators=(",", ":")),
        "updateDiagram": True,
        "rough": False,
    }
    data = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(zlib.compress(data, level=9)).decode("ascii").rstrip("=")
    return "https://mermaid.live/edit#pako:" + encoded


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="-", help="UTF-8 .mmd file, or - for stdin")
    args = parser.parse_args()
    try:
        code = sys.stdin.read() if args.source == "-" else Path(args.source).read_text(encoding="utf-8")
        print(make_url(code))
    except (OSError, UnicodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
