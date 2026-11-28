#!/usr/bin/env python3
"""证明 pnpm audit 真产出了一份可判定的报告。

security-scan.yml 现在用 `pnpm audit ... --json > audit.json || true` 放行那一条命令，
否则命中 high 时命令自己退非零、豁免清单永远用不上。放行之后"命令失败"不再自动变红：
网络断、registry 5xx、pnpm 崩掉，产物可能是一个空文件或一段 HTML 错误页。
tools/check_pnpm_audit_exceptions.py 只看 advisories / vulnerabilities，
空对象在它眼里就是"没有漏洞"——所以这一步必须先证明报告是报告。
"""

import json
import sys

REQUIRED_KEY = "vulnerabilities"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write("usage: assert_pnpm_audit_report.py <audit.json>\n")
        return 2

    path = argv[1]
    try:
        with open(path, "r", encoding="utf-8") as handle:
            report = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"::error::{path} is not a readable audit report: {exc}\n")
        return 1

    if not isinstance(report, dict):
        sys.stderr.write(f"::error::{path} is not an audit report object\n")
        return 1

    metadata = report.get("metadata")
    vulnerabilities = metadata.get(REQUIRED_KEY) if isinstance(metadata, dict) else None
    if not isinstance(vulnerabilities, dict):
        sys.stderr.write(
            f"::error::{path} has no metadata.{REQUIRED_KEY}; "
            "a failed audit must not look like a clean one\n"
        )
        return 1

    summary = ", ".join(f"{name}={count}" for name, count in sorted(vulnerabilities.items()))
    print(f"audit report parsed: {summary or 'no severity counters'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
