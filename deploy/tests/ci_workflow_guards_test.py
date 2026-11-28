"""必检 job 不许被过滤掉，也不许被 skip 成自由通过。

为什么解析而不是正则：2026-11-28 实测三种 YAML 等价写法全部绕过按字面 `key:` 写的
正则——`needs : [frontend]`、`if : ...`、`"needs": [frontend]` 解析出来的键就是
needs / if，正则一条都接不住，只有规范写法能被抓到。正则加黑名单这条路追不上
YAML 的等价写法，所以这里 `yaml.safe_load` 解析文档再断言键。

守四件事：

1. 必检 job 块里不出现 if / paths / paths-ignore / continue-on-error / needs。
   唯一豁免是 needs 与 `if: always()` 同时出现：always() 让 job 无论如何都跑，skip
   这条路被堵死。单独一个 `if: always()` 也放行——它不能跳过 job，只会强制它跑；
   `if:` 的其他写法一律红（见 job_offenders）。豁免认两种等价写法：裸 `always()` 与
   `${{ always() }}`，判定前先 strip，`if: ' always() '` 这类引号内空白也算同一个值；
   `always() && 某条件` 不在豁免内。
   必检清单本身要和 `docs/ci/branch-protection.md` 里那份 context 清单**集合相等**：
   规则集不在仓库里，文档是它在仓内的唯一锚点，两边不可能靠各自维护保持一致。
2. 触发面：承载必检的 workflow 必须仍由 `pull_request` 触发，且 `pull_request` 下
   不得按 base（branches / branches-ignore）或路径（paths / paths-ignore）过滤——
   stacked PR 的 base 不是 main，只改文档的 PR 不命中路径，这些 PR 上检查一条都
   不会产生，分支保护一直 Expected。
   `types:` 有意不在禁列：它让后续 push 不重跑，但 check run 挂在 head sha 上，
   不触发就是新 head 上一条 check run 都没有，分支保护照样卡住合并——失败形态是
   死锁，产生不了假通过；而 `[opened, synchronize, reopened, ready_for_review]` 是
   常见合法写法，禁掉误伤大于收益。真要盯「重跑缺失」，那是另一条断言。
3. 两个断言下限的脚本里，每个 `| tee` 之后必须读 PIPESTATUS。否则脚本的退出码来自
   tee，`FAILED (failures=1)` 会被打印出来然后脚本照样退 0——比没有门禁更糟。
4. `race` 的 `-run` 正则今天仍命中 >= 下限条测试（零命中时 go test 退 0）。

跑法：`python3 deploy/tests/ci_workflow_guards_test.py -v`
"""

from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]

# 必检清单的来源是规则集 28278717（`GET /repos/{o}/{r}/rulesets/28278717`），
# 文档在 docs/ci/branch-protection.md。改这里必须同时改那份文档——
# DocumentedContextsTests 会把两份集合钉在一起，只改一边就红。
REQUIRED_JOBS = {
    ".github/workflows/backend-ci.yml": (
        "shell",
        "test",
        "race",
        "frontend",
        "golangci-lint",
        "release-helpers",
        "embed",
        "e2e",
    ),
    ".github/workflows/security-scan.yml": (
        "backend-security",
        "frontend-security",
    ),
}

CONTEXT_DOC = "docs/ci/branch-protection.md"

FORBIDDEN_JOB_KEYS = ("if", "paths", "paths-ignore", "continue-on-error", "needs")
FORBIDDEN_TRIGGER_KEYS = ("paths", "paths-ignore", "branches", "branches-ignore")
ALWAYS = "always()"

# 断言下限的两个脚本：每个 `| tee` 之后必须读 PIPESTATUS。
TEE_SCRIPTS = (
    "backend/scripts/race-gate.sh",
    ".github/release-tools/run-tests.sh",
)


def load_workflow(path: Path) -> dict:
    """解析一个 workflow；解析不出 mapping 就硬失败。

    空文档（`yaml.safe_load("")` 得到 None）和语法非法都必须炸，不能返回空字典：
    空字典会让下面所有"键不在里面"的断言全部通过，那是比正则漏词更彻底的静默洞。
    """
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise AssertionError(
            f"{path} 解析出来不是 mapping（得到 {type(document).__name__}）——"
            "空文档或语法错误的 workflow 会让所有断言空过"
        )
    return document


def triggers(document: dict) -> dict:
    # `on` 在 YAML 1.1 里是布尔真，PyYAML 会把它解析成 True。
    value = document.get("on", document.get(True))
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        # `on: [push, pull_request]` 与 `on: {push: ..., pull_request: ...}` 是同一个
        # 触发面，归一成同样形状。不归一就会把列表形式误报成"没有 pull_request"。
        return {str(event): None for event in value}
    return {}


def is_always(value: object) -> bool:
    """整个条件就是 always()：裸值或 `${{ always() }}` 表达式。

    `always() && 某条件` 不是豁免——它仍可能在依赖失败时被 skip。
    """
    text = str(value).strip()
    if text.startswith("${{") and text.endswith("}}"):
        text = text[3:-2].strip()
    return text == ALWAYS


def documented_contexts(path: Path) -> set[str]:
    """从分支保护文档的 context 代码块里读出必检集合。

    规则集不在仓库里，这份文档是它在仓内的唯一锚点。读不到代码块或代码块为空
    都要硬失败：返回空集合的话，有的写法会让"两边相等"永远不成立（天天红），
    有的写法又会让它永远成立（永远绿），两种都比没有断言更糟。
    """
    text = path.read_text(encoding="utf-8")
    match = re.search(r"必需检查的 context.*?\n+\s*```[^\n]*\n(.*?)```", text, re.DOTALL)
    if match is None:
        raise AssertionError(f"{path} 里找不到必需检查的 context 代码块")
    contexts = set(match.group(1).split())
    if not contexts:
        raise AssertionError(f"{path} 的 context 代码块是空的")
    return contexts


def job_offenders(job: dict) -> list[str]:
    """一个 job 块里不该出现的键；needs 配 `if: always()` 是唯一豁免。"""
    if not isinstance(job, dict):
        raise AssertionError("job 块不是 mapping")

    always = is_always(job.get("if", ""))
    offenders = []
    for key in FORBIDDEN_JOB_KEYS:
        if key not in job:
            continue
        if key == "needs" and always:
            continue
        if key == "if" and always:
            continue
        offenders.append(key)
    return offenders


def trigger_offenders(document: dict) -> list[str]:
    """触发面的问题：没有 pull_request，或者它下面按 base / 路径过滤。"""
    events = triggers(document)
    if "pull_request" not in events:
        return ["pull_request"]
    pull_request = events["pull_request"]
    keys = set(pull_request) if isinstance(pull_request, dict) else set()
    return sorted(keys & set(FORBIDDEN_TRIGGER_KEYS))


class WorkflowDocumentTests(unittest.TestCase):
    """解析器自证：先证明它读到了东西，再拿它的结论做断言。"""

    def test_parser_reads_every_required_workflow(self) -> None:
        for relative, jobs in REQUIRED_JOBS.items():
            with self.subTest(workflow=relative):
                path = ROOT / relative
                self.assertTrue(path.is_file(), f"{relative} 不见了")
                document = load_workflow(path)
                parsed = document.get("jobs")
                self.assertIsInstance(parsed, dict, f"{relative} 里抽不出 jobs mapping")
                self.assertLessEqual(
                    set(jobs), set(parsed), f"{relative} 缺必检 job：{sorted(set(jobs) - set(parsed))}"
                )

    def test_parser_reads_known_keys_not_an_empty_dict(self) -> None:
        # 断言具体键，而不是"能 load 就算过"：解析器退回空字典时这里会红。
        backend = load_workflow(ROOT / ".github/workflows/backend-ci.yml")
        self.assertEqual(backend.get("name"), "CI")
        self.assertIn("jobs", backend)
        self.assertEqual(set(backend["jobs"]["shell"]), {"runs-on", "steps"})
        self.assertEqual(set(backend["jobs"]["frontend"]), {"runs-on", "steps"})
        self.assertEqual(
            triggers(backend).get("push"), {"branches": ["main"]}, "触发块没解析成预期结构"
        )

    def test_invalid_yaml_fails_instead_of_returning_empty(self) -> None:
        # 关键在 load_workflow 这一层：如果守卫把 YAMLError 吞掉返回 {}，
        # 下面所有"键不在里面"的断言都会空过——那比正则漏词更彻底。
        # 所以这里断言的是 load_workflow 抛，而不是 yaml.safe_load 会抛。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases = (
                ("syntax error", "jobs: [unclosed\n"),
                ("empty document", ""),
                ("not a mapping", "- shell\n- test\n"),
            )
            for label, text in cases:
                with self.subTest(case=label):
                    path = root / "probe.yml"
                    path.write_text(text, encoding="utf-8")
                    with self.assertRaises((yaml.YAMLError, AssertionError)):
                        load_workflow(path)


class GuardRuleTests(unittest.TestCase):
    """守卫规则自测：YAML 等价写法必须和规范写法得到同一个判定。"""

    def job(self, text: str) -> dict:
        document = yaml.safe_load("jobs:\n  probe:\n" + text)
        return document["jobs"]["probe"]

    def test_plain_job_is_clean(self) -> None:
        self.assertEqual(self.job("    runs-on: ubuntu-latest\n"), {"runs-on": "ubuntu-latest"})
        self.assertEqual(job_offenders(self.job("    runs-on: ubuntu-latest\n")), [])

    def test_needs_is_rejected_in_every_spelling(self) -> None:
        for label, text in (
            ("canonical", "    needs: [frontend]\n"),
            ("space before colon", "    needs : [frontend]\n"),
            ("quoted key", '    "needs": [frontend]\n'),
            ("single-quoted key", "    'needs': [frontend]\n"),
        ):
            with self.subTest(spelling=label):
                job = self.job(text)
                self.assertIn("needs", job, f"{label} 没解析出 needs 键，这条变体在测空气")
                self.assertEqual(job_offenders(job), ["needs"])

    def test_if_is_rejected_in_every_spelling(self) -> None:
        for label, text in (
            ("canonical", "    if: github.ref == 'refs/heads/main'\n"),
            ("space before colon", "    if : github.ref == 'refs/heads/main'\n"),
            ("quoted key", '    "if": github.ref == "refs/heads/main"\n'),
        ):
            with self.subTest(spelling=label):
                job = self.job(text)
                self.assertIn("if", job, f"{label} 没解析出 if 键，这条变体在测空气")
                self.assertEqual(job_offenders(job), ["if"])

    def test_needs_with_always_is_allowed(self) -> None:
        for label, text in (
            ("plain", "    needs: [frontend]\n    if: always()\n"),
            # 行尾空格是 YAML 自己吃掉的，所以这里测的必须是引号内的空白——
            # 只有它会走到 is_always 的 strip。
            ("spaces inside the quotes", "    needs: [frontend]\n    if: ' always() '\n"),
            ("quoted value", "    needs: [frontend]\n    if: 'always()'\n"),
            ("expression form", "    needs: [frontend]\n    if: ${{ always() }}\n"),
        ):
            with self.subTest(normalisation=label):
                self.assertEqual(job_offenders(self.job(text)), [])

    def test_needs_with_a_conditional_if_is_rejected(self) -> None:
        for label, text in (
            ("conjunction", "    needs: [frontend]\n    if: always() && github.ref == 'refs/heads/main'\n"),
            (
                "expression conjunction",
                "    needs: [frontend]\n    if: ${{ always() && github.ref == 'refs/heads/main' }}\n",
            ),
        ):
            with self.subTest(case=label):
                self.assertEqual(job_offenders(self.job(text)), ["if", "needs"])

    def test_always_alone_is_allowed(self) -> None:
        self.assertEqual(job_offenders(self.job("    if: always()\n")), [])

    def test_continue_on_error_and_paths_are_rejected(self) -> None:
        self.assertEqual(job_offenders(self.job("    continue-on-error: true\n")), ["continue-on-error"])
        self.assertEqual(job_offenders(self.job("    paths:\n      - 'backend/**'\n")), ["paths"])

    def test_trigger_face(self) -> None:
        def document(text: str) -> dict:
            return yaml.safe_load(text)

        cases = (
            ("pull_request alone", "on:\n  pull_request:\n", []),
            ("pull_request empty mapping", "on:\n  pull_request: {}\n", []),
            ("types is allowed", "on:\n  pull_request:\n    types: [opened, synchronize]\n", []),
            # 列表写法与 mapping 写法是同一个触发面，不许判成"没有 pull_request"。
            ("event list form", "on: [push, pull_request]\n", []),
            ("event list form without pull_request", "on: [push]\n", ["pull_request"]),
            ("no pull_request", "on:\n  push:\n    branches: [main]\n", ["pull_request"]),
            ("branches", "on:\n  pull_request:\n    branches: [main]\n", ["branches"]),
            ("branches-ignore", "on:\n  pull_request:\n    branches-ignore: [release/*]\n", ["branches-ignore"]),
            ("paths", "on:\n  pull_request:\n    paths: ['backend/**']\n", ["paths"]),
            (
                "paths-ignore",
                "on:\n  pull_request:\n    paths-ignore: ['docs/**']\n",
                ["paths-ignore"],
            ),
        )
        for label, text, expected in cases:
            with self.subTest(case=label):
                self.assertEqual(trigger_offenders(document(text)), expected)


class DocumentedContextsTests(unittest.TestCase):
    """守卫盯的必检清单必须和文档里那份 context 清单集合相等。

    规则集不在仓库里、review 看不见它，所以「规则集加了第 10 条，守卫还只盯 9 条」
    这种偏差只能靠仓库内两份文本互钉。断言写成集合相等而不是 `== 10`：条数会变，
    两边一致这件事不会。
    """

    def test_required_jobs_match_the_documented_context_set(self) -> None:
        documented = documented_contexts(ROOT / CONTEXT_DOC)
        guarded = {job for jobs in REQUIRED_JOBS.values() for job in jobs}
        self.assertEqual(
            guarded,
            documented,
            f"守卫清单与 {CONTEXT_DOC} 的 context 清单不一致："
            f"只在守卫里 {sorted(guarded - documented)}，只在文档里 {sorted(documented - guarded)}",
        )

    def test_document_without_the_block_fails(self) -> None:
        # 解析不到代码块必须硬失败：返回空集合的话，有的写法会让这条断言永绿。
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "doc.md"
            for label, text in (
                ("no block", "# 只有正文\n\n没有任何 fenced block\n"),
                ("empty block", "必需检查的 context：\n\n```\n```\n"),
                ("block but not the contexts one", "别的段落：\n\n```\nshell\n```\n"),
            ):
                with self.subTest(case=label):
                    path.write_text(text, encoding="utf-8")
                    with self.assertRaises(AssertionError):
                        documented_contexts(path)


class RequiredWorkflowTests(unittest.TestCase):
    """真实 workflow 的断言。"""

    def test_required_jobs_have_no_hiding_keys(self) -> None:
        for relative, names in REQUIRED_JOBS.items():
            document = load_workflow(ROOT / relative)
            jobs = document.get("jobs") or {}
            for name in names:
                with self.subTest(workflow=relative, job=name):
                    self.assertIn(name, jobs, f"{relative} 里没有必检 job {name}")
                    self.assertEqual(
                        job_offenders(jobs[name]),
                        [],
                        f"{relative} 的 {name} 可以被过滤掉或被 skip 成自由通过："
                        f"{job_offenders(jobs[name])}（if/paths/paths-ignore/continue-on-error "
                        "让 job 不跑，needs 让依赖失败时 skip 而 skip 按成功计）",
                    )

    def test_required_workflows_keep_pull_request_trigger(self) -> None:
        for relative in REQUIRED_JOBS:
            with self.subTest(workflow=relative):
                offenders = trigger_offenders(load_workflow(ROOT / relative))
                self.assertEqual(
                    offenders,
                    [],
                    f"{relative} 的触发面会让必检在部分 PR 上一条都不排队：{offenders}",
                )


class TeePipeStatusTests(unittest.TestCase):
    def test_every_tee_reads_pipe_status(self) -> None:
        for relative in TEE_SCRIPTS:
            with self.subTest(script=relative):
                path = ROOT / relative
                self.assertTrue(path.is_file(), f"{relative} 不见了")
                lines = path.read_text(encoding="utf-8").splitlines()
                self.assertIn("/usr/bin/env bash", lines[0], f"{relative} 必须是 bash 脚本（PIPESTATUS 需要）")
                tee_lines = [i for i, line in enumerate(lines) if "| tee " in line]
                self.assertTrue(tee_lines, f"{relative} 没有把测试输出 tee 出来，条数断言无法成立")
                for index in tee_lines:
                    window = lines[index + 1 : index + 4]
                    self.assertTrue(
                        any("PIPESTATUS" in line for line in window),
                        f"{relative}:{index + 1} 管道接了 tee 但没有读 PIPESTATUS——"
                        "退出码会来自 tee，失败的测试会被报成绿",
                    )


class RaceFilterTests(unittest.TestCase):
    def test_race_filter_still_selects_tests(self) -> None:
        gate = ROOT / "backend/scripts/race-gate.sh"
        self.assertTrue(gate.is_file(), "backend/scripts/race-gate.sh 不见了")
        text = gate.read_text(encoding="utf-8")
        filter_match = re.search(r"-run '([^']*)'", text)
        self.assertIsNotNone(filter_match, "读不出 race 的 -run 过滤器")
        floor_match = re.search(r"^readonly MIN_TESTS=(\d+)", text, re.MULTILINE)
        self.assertIsNotNone(floor_match, "读不出 race 的条数下限")

        pattern = re.compile(filter_match.group(1))
        floor = int(floor_match.group(1))
        hits = 0
        scanned = 0
        for package in ("service", "handler"):
            for path in sorted((ROOT / "backend/internal" / package).glob("*_test.go")):
                scanned += 1
                source = path.read_text(encoding="utf-8", errors="replace")
                if re.search(r"^//go:build.*!unit", source, re.MULTILINE):
                    continue
                for name in re.findall(r"^func (Test[A-Za-z0-9_]*)\(", source, re.MULTILINE):
                    if pattern.search(name):
                        hits += 1

        self.assertGreater(scanned, 0, "一个测试文件都没读到")
        self.assertGreater(hits, 0, f"race 的 -run 过滤器 {pattern.pattern!r} 一条测试都选不中")
        self.assertGreaterEqual(
            hits,
            floor,
            f"race 的 -run 过滤器只命中 {hits} 条，低于运行时下限 {floor}：-race 快变成空跑了",
        )


if __name__ == "__main__":
    unittest.main()
