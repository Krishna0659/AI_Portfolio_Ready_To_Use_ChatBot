"""Private, one-document subprocess. stdout is a bounded JSON protocol."""
import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".local" / "python-packages"))
sys.path.insert(0, str(Path(__file__).parent))
from preparation import MAX_BYTES, MAX_TEXT, FORMATS, normalize

# Reuse the existing hostile PDF/DOCX validation before structure extraction.
spec = importlib.util.spec_from_file_location("source_parser", ROOT / "services/extraction/parse.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def structured(data, kind):
    if kind not in FORMATS:
        raise ValueError("unsupported format")
    parser.extract(data, kind)
    title, section, blocks = "", "", []

    def add(value):
        value = normalize(value)
        if value:
            blocks.append({"section": section, "text": value})

    if kind == "html":
        soup = parser.BeautifulSoup(data.decode("utf-8-sig", errors="strict"), "html.parser")
        title = soup.title.get_text(" ", strip=True) if soup.title else ""
        for node in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "iframe", "form", "head", "title"]):
            node.decompose()
        # Walk text once, preserving block boundaries without duplicating nested lists.
        buffer = []
        def flush():
            add("".join(buffer))
            buffer.clear()
        def walk(node):
            nonlocal section, title
            name = getattr(node, "name", None)
            if name is None:
                if type(node).__name__ == "NavigableString":
                    buffer.append(str(node))
                return
            if re.fullmatch(r"h[1-6]", name):
                flush()
                section = normalize(node.get_text(" ", strip=True))
                title = title or section
                return
            boundary = name in {"p", "div", "main", "article", "section", "li", "ul", "ol", "br", "tr"}
            if boundary:
                flush()
            if name == "li":
                buffer.append("- ")
            for child in node.children:
                walk(child)
            if boundary:
                flush()
        walk(soup)
        flush()
    elif kind == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = [i.filename.replace("\\", "/") for i in archive.infolist()]
            if len(names) != len(set(names)) or any(".." in n.split("/") or ":" in n or n.startswith("/") for n in names):
                raise ValueError("unsafe archive")
            root = parser.ElementTree.fromstring(archive.read("word/document.xml"))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        w = "{" + ns["w"] + "}"
        for paragraph in root.findall(".//w:p", ns):
            value = "".join("\t" if n.tag == w + "tab" else "\n" if n.tag == w + "br" else n.text or ""
                            for n in paragraph.iter() if n.tag in {w + "t", w + "tab", w + "br"})
            style = paragraph.find("w:pPr/w:pStyle", ns)
            style_name = style.get(w + "val", "") if style is not None else ""
            # Unstyled documents commonly use short uppercase section labels.
            label = value.strip()
            inferred_heading = (label.isupper() and 2 <= len(label) <= 80
                                and len(label.split()) <= 10
                                and re.fullmatch(r"[A-Z][A-Z0-9 &/()–—-]*", label) is not None)
            if style_name.lower() == "title" or re.fullmatch(r"heading[1-6]", style_name, re.I) or inferred_heading:
                section = normalize(value)
                title = title or section
            else:
                add(("- " if paragraph.find("w:pPr/w:numPr", ns) is not None else "") + value)
    elif kind == "pdf":
        reader = parser.PdfReader(io.BytesIO(data), strict=True)
        title = str((reader.metadata or {}).get("/Title", ""))
        for index, page in enumerate(reader.pages, 1):
            if any(key in page for key in ("/AA", "/Annots")):
                raise ValueError("interactive PDF unsupported")
            section = f"Page {index}"
            for paragraph in re.split(r"\n\s*\n", page.extract_text() or ""):
                add(paragraph)
    else:
        # Use original blank lines: the legacy plain-text parser normalizes them away.
        original = normalize(data.decode("utf-8-sig", errors="strict"))
        pending = []
        fenced = False
        for line in original.splitlines():
            heading = re.match(r"^#{1,6}\s+(.+?)(?:\s+#+)?$", line) if kind == "md" and not fenced else None
            if kind == "md" and line.startswith(("```", "~~~")):
                fenced = not fenced
            if heading or not line or (not fenced and re.match(r"^(?:[-*+] |\d+[.)] )", line)):
                add("\n".join(pending))
                pending = []
            if heading:
                section = normalize(heading[1])
                title = title or section
            elif line:
                pending.append(line)
        add("\n".join(pending))
    title = normalize(title)
    if len(title) > 500 or not blocks or len(blocks) > 10_000 or sum(len(b["text"]) + len(b["section"]) for b in blocks) > MAX_TEXT:
        raise ValueError("extraction limits")
    return {"title": title, "blocks": blocks, "structure": "paragraphs" if kind == "docx" else "blocks"}


if __name__ == "__main__":
    try:
        value = structured(sys.stdin.buffer.read(MAX_BYTES + 1), sys.argv[1])
        print(json.dumps(value, ensure_ascii=True))
    except Exception:
        sys.exit(1)
