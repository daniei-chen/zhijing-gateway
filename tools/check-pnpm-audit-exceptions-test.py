#!/usr/bin/env python3
"""tools/check_pnpm_audit_exceptions.py 的自测。

历史：security-scan.yml 里 `pnpm audit --audit-level=high --json` 命中 high 时命令
自己先退非零，那一步就红了，豁免脚本没有任何机会运行——.github/audit-exceptions.yml
对 high/critical 是死配置。改成 `|| true` 之后，判定权全部落在豁免脚本上，
于是"这个脚本还判得动吗"本身就成了门禁的一部分，这里用真实形状的报告验它：

  * 未豁免的 high 必须退 1（否则门是空的）
  * 已豁免且未过期的 high 退 0（否则豁免通道不可用，又会有人去关掉整步）
  * 过期豁免退 1
  * 干净报告 / 只有 low 的报告退 0

跑法：python tools/check-pnpm-audit-exceptions-test.py -v
"""

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "tools" / "check_pnpm_audit_exceptions.py"

ADVISORY_ID = "GHSA-jf85-cpcp-j695"


def audit_report(*, high_packages: tuple[str, ...] = (), low_packages: tuple[str, ...] = ()) -> dict:
    """按 pnpm audit --json 的形状造报告：顶层 vulnerabilities + metadata 计数。"""
    vulnerabilities = {}
    for package in high_packages:
        vulnerabilities[package] = {
            "name": package,
            "severity": "high",
            "isDirect": True,
            "via": [{"source": 1, "name": package, "github_advisory_id": ADVISORY_ID, "title": "Prototype pollution"}],
            "effects": [],
            "range": "*",
            "nodes": ["node_modules/" + package],
            "fixAvailable": False,
        }
    for package in low_packages:
        vulnerabilities[package] = {
            "name": package,
            "severity": "low",
            "isDirect": True,
            "via": [{"source": 2, "name": package, "github_advisory_id": "GHSA-low", "title": "Minor issue"}],
            "effects": [],
            "range": "*",
            "nodes": ["node_modules/" + package],
            "fixAvailable": True,
        }

    def count(severity: str) -> int:
        packages = high_packages if severity == "high" else low_packages
        return len(packages)

    return {
        "auditReportVersion": 2,
        "vulnerabilities": vulnerabilities,
        "metadata": {
            "vulnerabilities": {
                "info": 0,
                "low": count("low"),
                "moderate": 0,
                "high": count("high"),
                "critical": 0,
            }
        },
    }


def exception_block(package: str, *, expires_on: str, severity: str = "high") -> str:
    return textwrap.dedent(
        f"""\
        version: 1
        exceptions:
          - package: {package}
            advisory: {ADVISORY_ID}
            severity: {severity}
            mitigation: no fixed version published yet, tracked in issue 123
            expires_on: {expires_on}
        """
    )


class AuditExceptionGateTest(unittest.TestCase):
    def run_checker(self, report: dict, exceptions_yaml: str) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory() as tmp:
            audit = Path(tmp) / "audit.json"
            audit.write_text(json.dumps(report), encoding="utf-8")
            exceptions = Path(tmp) / "audit-exceptions.yml"
            exceptions.write_text(exceptions_yaml, encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(CHECKER),
                    "--audit",
                    str(audit),
                    "--exceptions",
                    str(exceptions),
                ],
                capture_output=True,
                text=True,
            )

    def test_unexempted_high_vulnerability_fails(self) -> None:
        result = self.run_checker(audit_report(high_packages=("lodash",)), "version: 1\nexceptions: []\n")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("lodash", result.stderr)
        self.assertIn(ADVISORY_ID, result.stderr)

    def test_exempted_high_vulnerability_passes(self) -> None:
        result = self.run_checker(
            audit_report(high_packages=("lodash",)),
            exception_block("lodash", expires_on="2999-12-31"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Audit exceptions validated", result.stdout)

    def test_expired_exception_fails(self) -> None:
        result = self.run_checker(
            audit_report(high_packages=("lodash",)),
            exception_block("lodash", expires_on="2020-01-01"),
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("expired", result.stderr)

    def test_clean_report_passes(self) -> None:
        result = self.run_checker(audit_report(), "version: 1\nexceptions: []\n")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_low_severity_vulnerability_passes(self) -> None:
        result = self.run_checker(audit_report(low_packages=("left-pad",)), "version: 1\nexceptions: []\n")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
