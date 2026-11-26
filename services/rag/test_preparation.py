import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".local/python-packages"))
from preparation import (Scope, prepare, extract, PreparationError, MAX_CHUNK, normalize)

SCOPE = Scope("tenant", "profile", "resume", 3, 7, "approved-profile", "Portfolio", "configured-model")


def docx(xml, extra=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", xml)
        for name, value in (extra or {}).items():
            archive.writestr(name, value)
    return buffer.getvalue()


def pdf(encrypted=False):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 50 700 Td (Built a synthetic portfolio search system.) Tj ET")
    page[NameObject("/Contents")] = stream
    writer.add_metadata({"/Title": "Synthetic resume"})
    if encrypted:
        writer.encrypt("password")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class PreparationTests(unittest.TestCase):
    def test_markdown_sections_stability_and_trusted_metadata(self):
        data = b"# Resume\n\n## Projects\n- Built SearchKit in 2025.\n- Used Python and SQL.\n\n## Education\nStudied computer science."
        first = prepare(data, "md", SCOPE)
        self.assertEqual(first, prepare(data, "md", SCOPE))
        self.assertEqual([c["metadata"]["section"] for c in first["chunks"]], ["Projects", "Education"])
        self.assertEqual(first["chunks"][0]["metadata"]["generation"], 7)
        self.assertEqual(first["chunks"][0]["metadata"]["embedding_model"], "configured-model")
        changed = prepare(data + b"\n\n## New section\nAn unrelated additional paragraph.", "md", SCOPE)
        self.assertEqual(first["chunks"][0]["metadata"]["chunk_id"], changed["chunks"][0]["metadata"]["chunk_id"])

    def test_html_structure_and_removal(self):
        result = prepare(b"<html><title>Portfolio</title><nav>SECRET NAV</nav><main><h2>Projects</h2><p>Built a <strong>search</strong> system.</p><ul><li>Uses Python for retrieval.</li></ul><script>SECRET SCRIPT</script></main></html>", "html", SCOPE)
        chunk = result["chunks"][0]
        self.assertEqual(result["title"], "Portfolio")
        self.assertEqual(chunk["metadata"]["section"], "Projects")
        self.assertIn("Built a search system.", chunk["text"])
        self.assertIn("- Uses Python", chunk["text"])
        self.assertNotIn("SECRET", chunk["text"])

    def test_docx_headings_and_list(self):
        data = docx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Projects</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Built a synthetic search service.</w:t></w:r></w:p></w:body></w:document>')
        chunk = prepare(data, "docx", SCOPE)["chunks"][0]
        self.assertEqual(chunk["metadata"]["section"], "Projects")
        self.assertEqual(chunk["text"], "- Built a synthetic search service.")

    def test_docx_all_caps_headings_and_paragraph_boundaries(self):
        data = docx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            '<w:p><w:r><w:t>LEADERSHIP</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>Operational Head | Robogenesis (AI/Robotics Club)</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>Placement Coordinator | Placement Career Services Centre</w:t></w:r></w:p>'
            '</w:body></w:document>')
        result = prepare(data, "docx", SCOPE)
        self.assertEqual([c["metadata"]["section"] for c in result["chunks"]], ["LEADERSHIP"])
        self.assertIn('Operational Head',result['chunks'][0]['text'])
        self.assertIn('Placement Coordinator',result['chunks'][0]['text'])

    def test_pdf_page_provenance(self):
        result = prepare(pdf(), "pdf", SCOPE)
        self.assertEqual(result["title"], "Synthetic resume")
        self.assertEqual(result["chunks"][0]["metadata"]["section"], "Page 1")
        self.assertIn("portfolio search", result["chunks"][0]["text"])

    def test_unstyled_domain_headings_preserve_sections(self):
        data=docx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                  '<w:p><w:r><w:t>OPERATIONS &amp; MAINTENANCE</w:t></w:r></w:p>'
                  '<w:p><w:r><w:t>Inspect equipment weekly.</w:t></w:r></w:p>'
                  '<w:p><w:r><w:t>INCIDENT RESPONSE</w:t></w:r></w:p>'
                  '<w:p><w:r><w:t>DO NOT RESTART.</w:t></w:r></w:p></w:body></w:document>')
        rows=prepare(data,'docx',SCOPE)['chunks']
        self.assertEqual([r['metadata']['section'] for r in rows],['OPERATIONS & MAINTENANCE','INCIDENT RESPONSE'])
        self.assertEqual(rows[1]['text'],'DO NOT RESTART.')

    def test_plain_text_normalization(self):
        result = prepare("A synthetic re\u0301sume\u0301.\r\n\r\nBuilt search with Python. ".encode(), "txt", SCOPE)
        self.assertIn("résumé", result["chunks"][0]["text"])
        self.assertIn("\n\n", result["chunks"][0]["text"])

    def test_bounds_and_no_identifier_split(self):
        data = ("SearchKit-2025 " * 700).encode()
        chunks = prepare(data, "txt", SCOPE)["chunks"]
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c["text"]) <= MAX_CHUNK for c in chunks))
        self.assertTrue(all(c["text"].endswith("SearchKit-2025") for c in chunks))
        with self.assertRaisesRegex(PreparationError, "oversized_identifier"):
            prepare(b"x" * 4001, "txt", SCOPE)

    def test_duplicate_chunks_removed_without_cross_section_loss(self):
        text = b"# Projects\nA sufficiently long repeated paragraph.\n# Projects\nA sufficiently long repeated paragraph.\n# Education\nA sufficiently long repeated paragraph."
        # A repeat within a packed chunk is preserved; deduplication applies to complete chunks.
        result = prepare(text, "md", SCOPE)
        self.assertEqual(len(result["chunks"]), 2)
        block = "word " * 799
        result = prepare(("# A\n" + block + "\n\n" + block).encode(), "md", SCOPE)
        self.assertEqual(len(result["chunks"]), 1)

    def test_rejects_unsafe_formats(self):
        cases = [(b"hello" * 10, "exe"), (b"", "txt"), (b"x" * (10 * 1024 * 1024 + 1), "txt"),
                 (b"bad\xff encoding with enough text", "txt"), (b"control\0 in sufficiently long content", "txt"),
                 (b"<script>only script and no evidence</script>", "html"), (pdf(True), "pdf"),
                 (docx("bad", {"../escape": "bad"}), "docx"),
                 (docx("bad", {"word/vbaProject.bin": "bad"}), "docx"),
                 (docx('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x>&e;</x>'), "docx")]
        for data, kind in cases:
            with self.subTest(kind=kind, size=len(data)), self.assertRaises(PreparationError):
                prepare(data, kind, SCOPE)

    def test_scope_validation(self):
        for field, value in [("tenant_id", "../other"), ("generation", True), ("document_version", 0), ("embedding_model", "")]:
            values = dict(SCOPE.__dict__)
            values[field] = value
            with self.assertRaises(PreparationError):
                Scope(**values)

    def test_timeout_and_credential_isolation(self):
        with patch("preparation.subprocess.run", side_effect=subprocess.TimeoutExpired("parser", 1)) as run:
            with self.assertRaisesRegex(PreparationError, "extraction_timeout"):
                extract(b"A sufficiently long paragraph.", "txt")
            self.assertEqual(run.call_args.kwargs["env"], {})
            self.assertIn("-I", run.call_args.args[0])

    def test_malformed_worker_output(self):
        for value in [b"bad json", b'{"title":"x","blocks":[]}', b'{"title":"x","blocks":[{"text":"x"}]}']:
            with patch("preparation.subprocess.run", return_value=subprocess.CompletedProcess([], 0, value)):
                with self.assertRaisesRegex(PreparationError, "invalid_extraction"):
                    extract(b"A sufficiently long paragraph.", "txt")


if __name__ == "__main__":
    unittest.main()
