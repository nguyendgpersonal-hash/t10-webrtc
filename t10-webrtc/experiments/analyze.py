"""Phân tích nhanh các file JSONL trong experiments/logs/.

Mỗi dòng có thể có:
{"scenario":"E1","candidateType":"host","hashOk":true,...}
"""

import json
from collections import Counter
from pathlib import Path

LOG_DIR = Path(__file__).parent / "logs"


def load_jsonl(path: Path):
    rows = []
    if not path.exists():
        return rows
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as exc:
            print(f"[WARN] {path.name}:{line_no}: {exc}")
    return rows


def main():
    files = sorted(LOG_DIR.glob("E*.jsonl"))
    if not files:
        print("Chưa có E1.jsonl/E2.jsonl/E3.jsonl trong experiments/logs/")
        return

    for path in files:
        rows = load_jsonl(path)
        if not rows:
            continue

        candidate_types = Counter(
            str(row.get("candidateType", "unknown"))
            for row in rows
            if row.get("candidateType") is not None
        )
        hash_values = [row.get("hashOk") for row in rows if "hashOk" in row]

        print(f"\n=== {path.name} ===")
        print(f"records: {len(rows)}")
        print(f"candidateType: {dict(candidate_types)}")
        if hash_values:
            print(f"hashOk: {hash_values}")
            print(f"all hashOk=true: {all(value is True for value in hash_values)}")


if __name__ == "__main__":
    main()
