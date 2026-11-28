"""注入矩阵：同一批 workflow 变体 × 若干守卫，输出 rc 表。

用途有两个：

1. 证明守卫真的会红。变体是**注入到被守卫仓库的真实 workflow 文件**上的（不是
   fixture），每个变体注入后先用 yaml 复核「目标键确实出现了」，否则矩阵就是在测
   空气；跑完立刻还原。
2. 跨仓对照。守卫怎么跑是参数，所以既可以是 shell 守卫（`sh path`），也可以是
   Python 守卫（`python path`）。同一份矩阵在两个仓库上跑，结论才能并排看。

用法：

    python deploy/tests/ci_workflow_guards_matrix.py \\
        --repo . \\
        --workflow .github/workflows/backend-ci.yml \\
        --job race \\
        --guard 'new=python deploy/tests/ci_workflow_guards_test.py -q' \\
        --guard 'old=sh deploy/tests/.old-guard.sh'

`--guard` 是 `label=命令`，可重复；必须有一个叫 `new`。新守卫的 rc 会和变体声明的
预期比对（红/绿），不一致就退 1；其它守卫只报 rc，供并排看。

依赖 PyYAML==6.0.3（同一个 pin，见 .github/release-tools/requirements-release.txt）。
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Variant:
    name: str
    description: str
    expect: str  # "red" | "green"
    job_lines: tuple[str, ...] = ()
    trigger: str = ""  # "drop" | "branches" | ""


VARIANTS = (
    Variant("baseline", "无改动", "green"),
    Variant("needs-canonical", "needs: [frontend]", "red", job_lines=("    needs: [frontend]",)),
    Variant("needs-space", "needs : [frontend]（冒号前有空格）", "red", job_lines=("    needs : [frontend]",)),
    Variant("needs-quoted", '"needs": [frontend]（引号键）', "red", job_lines=('    "needs": [frontend]',)),
    Variant(
        "if-canonical",
        "if: github.event_name == 'push'",
        "red",
        job_lines=("    if: github.event_name == 'push'",),
    ),
    Variant(
        "if-space",
        "if : github.event_name == 'push'（冒号前有空格）",
        "red",
        job_lines=("    if : github.event_name == 'push'",),
    ),
    Variant(
        "needs-with-always",
        "needs + if: always()",
        "green",
        job_lines=("    needs: [frontend]", "    if: always()"),
    ),
    Variant(
        "needs-with-always-trailing-space",
        "needs + if: always()    （尾随空格）",
        "green",
        job_lines=("    needs: [frontend]", "    if: always()    "),
    ),
    Variant(
        "needs-with-quoted-always",
        "needs + if: 'always()'（引用形式，YAML 里是同一个值）",
        "green",
        job_lines=("    needs: [frontend]", "    if: 'always()'"),
    ),
    Variant("trigger-no-pull-request", "删掉 on: pull_request:", "red", trigger="drop"),
    Variant(
        "trigger-branches",
        "pull_request 下加 branches: [main]",
        "red",
        trigger="branches",
    ),
)


def newline_of(line: str) -> str:
    """跟进原文件的换行符：CRLF 检出（Windows/core.autocrlf）下注入行也得是 CRLF。"""
    if line.endswith("\r\n"):
        return "\r\n"
    return "\n" if line.endswith("\n") else ""


def fail(message: str) -> None:
    sys.stderr.write(f"matrix: {message}\n")
    raise SystemExit(2)


def job_header_index(lines: list[str], job: str) -> int:
    for index, line in enumerate(lines):
        if line.rstrip("\r\n") == f"  {job}:":
            return index
    fail(f"workflow 里找不到 job '{job}'（矩阵的 --job 必须是必检 job 名）")


def pull_request_index(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if line.rstrip("\r\n") == "  pull_request:":
            return index
    fail("workflow 的 on: 块里找不到 `  pull_request:`，触发面变体无从注入")


def mutate(original: str, variant: Variant, job: str) -> str:
    if variant.name == "baseline":
        return original
    lines = original.splitlines(keepends=True)
    if variant.trigger == "drop":
        del lines[pull_request_index(lines)]
    elif variant.trigger == "branches":
        index = pull_request_index(lines)
        newline = newline_of(lines[index])
        lines[index] = f"  pull_request:{newline}    branches: [main]{newline}"
    elif variant.job_lines:
        index = job_header_index(lines, job)
        newline = newline_of(lines[index])
        injected = "".join(f"{line}{newline}" for line in variant.job_lines)
        lines.insert(index + 1, injected)
    return "".join(lines)


def verify_mutation(text: str, variant: Variant, job: str, workflow: Path) -> None:
    """确认这次注入真的产生了我们想验的东西，否则矩阵在测空气。"""
    document = yaml.safe_load(text)
    if not isinstance(document, dict):
        fail(f"{variant.name}: 注入后 {workflow} 解析不出 mapping")
    if variant.trigger == "drop":
        events = document.get("on", document.get(True)) or {}
        if "pull_request" in events:
            fail(f"{variant.name}: 注入后 pull_request 还在，变体没生效")
        return
    if variant.trigger == "branches":
        events = document.get("on", document.get(True)) or {}
        pull_request = events.get("pull_request")
        if not isinstance(pull_request, dict) or "branches" not in pull_request:
            fail(f"{variant.name}: 注入后 pull_request.branches 没出现，变体没生效")
        return
    if variant.job_lines:
        job_block = (document.get("jobs") or {}).get(job)
        if not isinstance(job_block, dict):
            fail(f"{variant.name}: 注入后读不出 job '{job}'")
        expected = {line.strip().split(":", 1)[0].strip().strip('"').strip("'") for line in variant.job_lines}
        missing = sorted(key for key in expected if key not in job_block)
        if missing:
            fail(f"{variant.name}: 注入后 job '{job}' 里没有 {missing}，变体没生效")


def run_guard(command: str, repo: Path) -> tuple[int, str]:
    completed = subprocess.run(
        command,
        shell=True,
        cwd=str(repo),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    return completed.returncode, output


def main() -> int:
    parser = argparse.ArgumentParser(description="workflow 守卫的注入矩阵")
    parser.add_argument("--repo", default=".", help="被守卫仓库的根目录")
    parser.add_argument("--workflow", required=True, help="workflow 相对路径")
    parser.add_argument("--job", required=True, help="注入 job 级变体用的必检 job 名")
    parser.add_argument(
        "--guard",
        action="append",
        default=[],
        metavar="LABEL=COMMAND",
        help="守卫的命令，可重复；必须有一个叫 new",
    )
    parser.add_argument("--keep", action="store_true", help="保留最后一次注入（调试用）")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    workflow = (repo / args.workflow).resolve()
    if not workflow.is_file():
        fail(f"{workflow} 不存在")

    guards = []
    for spec in args.guard:
        label, _, command = spec.partition("=")
        if not label or not command:
            fail(f"--guard 要写成 label=command，收到 {spec!r}")
        guards.append((label, command))
    if not guards:
        fail("至少给一个 --guard")
    labels = [label for label, _ in guards]
    if "new" not in labels:
        fail("--guard 里必须有一个叫 new 的（预期由它来判）")
    if len(set(labels)) != len(labels):
        fail(f"--guard 标签重复：{labels}")

    original_bytes = workflow.read_bytes()
    original = original_bytes.decode("utf-8")
    width = max(len(variant.name) for variant in VARIANTS)
    header = "variant".ljust(width + 2) + "".join(label.ljust(7) for label in labels) + "new 判读"
    print(header)
    print("-" * len(header))

    mismatches = 0
    try:
        for variant in VARIANTS:
            workflow.write_bytes(mutate(original, variant, args.job).encode("utf-8"))
            verify_mutation(workflow.read_text(encoding="utf-8"), variant, args.job, workflow)
            results = {}
            outputs = {}
            for label, command in guards:
                code, output = run_guard(command, repo)
                results[label] = code
                outputs[label] = output
            expected = 0 if variant.expect == "green" else 1
            verdict = "OK" if (results["new"] != 0) == (expected != 0) else "MISMATCH"
            if verdict != "OK":
                mismatches += 1
            row = variant.name.ljust(width + 2) + "".join(str(results[label]).ljust(7) for label in labels)
            print(f"{row}{verdict} ({variant.expect})")
            if verdict != "OK":
                tail = "\n".join(outputs["new"].strip().splitlines()[-6:])
                print(f"  new 守卫输出：\n{tail}")
    finally:
        if not args.keep:
            workflow.write_bytes(original_bytes)

    print()
    print(f"变体 {len(VARIANTS)} 个，守卫 {len(labels)} 个（{', '.join(labels)}），new 判读不一致 {mismatches} 个")
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
