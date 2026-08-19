#!/usr/bin/env python3
"""Convert the uploaded accounting DOCX quiz bundle into reviewed MCQ JSON.

The source documents use a two-column Word table: the left cell contains the
question, choices and explanation; the right cell contains the teacher answer.
Automatic Word list labels are reconstructed from paragraph numbering metadata.
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from collections import Counter
from pathlib import Path

from lxml import etree

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
PUBLIC_SOURCE = "115年會計研究所班 中級會計學"
TIMESTAMP_PREFIX = re.compile(r"^\d{14,20}_")
ANSWER_RE = re.compile(r"^[（(]?\s*([A-Da-d])\s*[）)]?\.?$")
SOURCE_RE = re.compile(r"^[（(](?:10\d|11\d|\d{2,3}年)[^\n]{0,90}[）)]$")
EXPLANATION_LABEL_RE = re.compile(r"^(?:計算過程|解析|解答|說明)\s*[：:]?$")


def clean(value: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", value)).strip()


def clean_option(value: str) -> str:
    normalized = clean(value).rstrip("。.")
    if re.fullmatch(r"[a-f]{5,6}", normalized, re.IGNORECASE):
        return " → ".join(normalized)
    return clean(value)


def paragraph_text(paragraph: etree._Element) -> str:
    return clean("".join(paragraph.xpath(".//w:t/text()", namespaces=NS)))


def paragraph_num_id(paragraph: etree._Element) -> str:
    values = paragraph.xpath("./w:pPr/w:numPr/w:numId/@w:val", namespaces=NS)
    return values[0] if values else ""


def cell_paragraphs(cell: etree._Element) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for paragraph in cell.xpath(".//w:p", namespaces=NS):
        text = paragraph_text(paragraph)
        if text:
            rows.append({"text": text, "num_id": paragraph_num_id(paragraph)})
    return rows


def split_explicit_options(lines: list[dict[str, str]]) -> tuple[str, dict[str, str], list[str]] | None:
    rendered_lines = [dict(line) for line in lines]
    question_num_id = rendered_lines[0]["num_id"] if rendered_lines else ""
    nested_ids = Counter(
        line["num_id"] for line in rendered_lines[1:]
        if line["num_id"] and line["num_id"] != question_num_id
    )
    # Word stores automatic list markers outside w:t.  A six-item nested list
    # immediately before explicit A–D choices is the common a–f ordering form.
    six_item_id = next((num_id for num_id, count in nested_ids.items() if count == 6), "")
    if six_item_id:
        marker = iter("abcdef")
        for line in rendered_lines:
            if line["num_id"] == six_item_id:
                line["text"] = f"{next(marker)}. {line['text']}"
    joined = "\n".join(line["text"] for line in rendered_lines)
    # A number of the source tables place all four choices in one or two
    # paragraphs, so a choice label does not necessarily start a new line.
    matches = list(re.finditer(r"(?<!\w)[（(]([A-D])[）)]\s*", joined))
    if len(matches) < 4 or [m.group(1) for m in matches[:4]] != list("ABCD"):
        matches = list(re.finditer(r"(?:^|\n)\s*([A-Da-d])[.、]\s*", joined))
    if len(matches) < 4 or [m.group(1).upper() for m in matches[:4]] != list("ABCD"):
        return None
    choices: dict[str, str] = {}
    for index, match in enumerate(matches[:4]):
        end = matches[index + 1].start() if index < 3 else len(joined)
        choices[match.group(1).upper()] = clean(joined[match.end() : end])
    d_lines = choices.get("D", "").splitlines()
    d_stop = next(
        (index for index, text in enumerate(d_lines) if SOURCE_RE.match(text) or EXPLANATION_LABEL_RE.match(text)),
        len(d_lines),
    )
    choices["D"] = clean("\n".join(d_lines[:d_stop]))
    return clean(joined[: matches[0].start()]), choices, []


def split_numbered_options(lines: list[dict[str, str]]) -> tuple[str, dict[str, str], list[str]] | None:
    if not lines:
        return None
    question_num_id = lines[0]["num_id"]
    before_explanation: list[dict[str, str]] = []
    tail: list[str] = []
    in_tail = False
    for line in lines:
        if EXPLANATION_LABEL_RE.match(line["text"]):
            in_tail = True
            continue
        (tail if in_tail else before_explanation).append(line if not in_tail else line["text"])
    option_num_ids = Counter(
        line["num_id"]
        for line in before_explanation[1:]
        if line["num_id"] and line["num_id"] != question_num_id
    )
    if not option_num_ids:
        return None
    option_num_id, count = option_num_ids.most_common(1)[0]
    if count < 4:
        return None
    starts = [index for index, line in enumerate(before_explanation) if line["num_id"] == option_num_id]
    if len(starts) < 4:
        return None
    starts = starts[:4]
    choices: dict[str, str] = {}
    for offset, start in enumerate(starts):
        end = starts[offset + 1] if offset < 3 else len(before_explanation)
        chunk = [line["text"] for line in before_explanation[start:end]]
        # Source citations and unlabelled explanation belong after choice D.
        if offset == 3:
            stop = next((i for i, text in enumerate(chunk[1:], 1) if SOURCE_RE.match(text)), len(chunk))
            tail = chunk[stop:] + tail
            chunk = chunk[:stop]
        choices["ABCD"[offset]] = clean("\n".join(chunk))
    stem = clean("\n".join(line["text"] for line in before_explanation[: starts[0]]))
    return stem, choices, tail


def source_and_explanation(lines: list[dict[str, str]], parsed_tail: list[str]) -> tuple[str, str]:
    texts = [line["text"] for line in lines]
    source = next((text.strip("（）()") for text in texts if SOURCE_RE.match(text)), "")
    explanation: list[str] = []
    start = next((i for i, text in enumerate(texts) if EXPLANATION_LABEL_RE.match(text)), -1)
    if start >= 0:
        explanation = texts[start + 1 :]
    elif parsed_tail:
        explanation = [text for text in parsed_tail if not SOURCE_RE.match(text)]
    return source, clean("\n".join(explanation))


def parse_docx(path: Path) -> tuple[list[dict[str, object]], Counter]:
    counters: Counter = Counter()
    questions: list[dict[str, object]] = []
    original_name = path.name
    internal_name = TIMESTAMP_PREFIX.sub("", original_name)
    with zipfile.ZipFile(path) as archive:
        root = etree.fromstring(archive.read("word/document.xml"))
    internal_sequence = 0
    for table_row in root.xpath("./w:body/w:tbl/w:tr", namespaces=NS):
        cells = table_row.xpath("./w:tc", namespaces=NS)
        if len(cells) != 2:
            continue
        left, right = cell_paragraphs(cells[0]), cell_paragraphs(cells[1])
        answer_text = clean("\n".join(line["text"] for line in right))
        answer_match = ANSWER_RE.match(answer_text)
        if not answer_match:
            continue
        counters["answer_rows"] += 1
        parsed = split_explicit_options(left) or split_numbered_options(left)
        if not parsed:
            counters["rejected_option_split"] += 1
            continue
        stem, options, tail = parsed
        if len(stem) < 12 or any(len(clean(options.get(key, ""))) < 1 for key in "ABCD"):
            counters["rejected_incomplete"] += 1
            continue
        if any(len(options[key]) > 1800 for key in "ABCD") or len(stem) > 7000:
            counters["rejected_oversize"] += 1
            continue
        internal_sequence += 1
        source_exam, explanation = source_and_explanation(left, tail)
        questions.append(
            {
                "examType": "mcq",
                "examCategory": "accounting",
                "year": source_exam or "115年會研所班題庫",
                "examName": PUBLIC_SOURCE,
                "subject": "中級會計學",
                "questionNumber": str(internal_sequence),
                "stem": stem,
                "options": {key: clean_option(options[key]) for key in "ABCD"},
                "correctAnswer": answer_match.group(1).upper(),
                "explanation": explanation,
                "teacherNotes": f"內部來源：{internal_name}｜原始列序：{counters['answer_rows']}",
                "answerSource": "Word教師題庫答案欄",
                "sourceUrl": f"accounting-word-bank:v3:{internal_name}:{counters['answer_rows']}",
                "status": "published",
            }
        )
        counters["accepted"] += 1
    return questions, counters


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_json", type=Path)
    parser.add_argument("report_json", type=Path)
    args = parser.parse_args()
    all_questions: list[dict[str, object]] = []
    report_files: list[dict[str, object]] = []
    totals: Counter = Counter()
    for path in sorted(args.input_dir.glob("*.docx")):
        questions, counters = parse_docx(path)
        all_questions.extend(questions)
        totals.update(counters)
        report_files.append({"file": TIMESTAMP_PREFIX.sub("", path.name), **dict(counters)})
    unique_questions: list[dict[str, object]] = []
    seen: set[str] = set()
    for question in all_questions:
        source_file = str(question["teacherNotes"]).split("｜", 1)[0]
        fingerprint = re.sub(
            r"\W+",
            "",
            source_file + str(question["stem"]) + json.dumps(question["options"], ensure_ascii=False, sort_keys=True),
        ).lower()
        if fingerprint in seen:
            totals["rejected_duplicate"] += 1
            continue
        seen.add(fingerprint)
        unique_questions.append(question)
    for index, question in enumerate(unique_questions, 1):
        question["questionNumber"] = str(index)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(unique_questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    args.report_json.write_text(
        json.dumps({"publicSource": PUBLIC_SOURCE, "files": report_files, "totals": dict(totals)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"files": len(report_files), "questions": len(unique_questions), "totals": totals}, ensure_ascii=False, default=dict))


if __name__ == "__main__":
    main()
