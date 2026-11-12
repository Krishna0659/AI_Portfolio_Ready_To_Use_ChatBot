import importlib.util, io, zipfile, unittest, pathlib
spec=importlib.util.spec_from_file_location('extractor',pathlib.Path(__file__).with_name('parse.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ParserTests(unittest.TestCase):
    def archive(self,name,content):
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:z.writestr(name,content)
        return buf.getvalue()
    def test_html_excludes_scripts(self):
        text=module.extract(b'<main>A sufficiently long real biography</main><script>malicious instructions</script>','html')
        self.assertNotIn('malicious',text)
    def test_traversal(self):
        with self.assertRaises(ValueError):module.extract(self.archive('../bad','bad'),'docx')
    def test_zip_bomb_ratio(self):
        with self.assertRaises(ValueError):module.extract(self.archive('word/document.xml','a'*1000000),'docx')
    def test_entities(self):
        xml='<!DOCTYPE doc [<!ENTITY xxe SYSTEM "file:///secret">]><doc>&xxe;</doc>'
        with self.assertRaises(Exception):module.extract(self.archive('word/document.xml',xml),'docx')
    def test_invalid_pdf(self):
        with self.assertRaises(ValueError):module.extract(b'not a pdf','pdf')
    def test_oversize(self):
        with self.assertRaises(ValueError):module.extract(b'x'*10485761,'txt')
    def test_embedded_macro_rejection(self):
        with self.assertRaises(ValueError):module.extract(self.archive('word/vbaProject.bin','sub test()'),'docx')
    def test_embedded_executable_folder_rejection(self):
        with self.assertRaises(ValueError):module.extract(self.archive('word/embeddings/payload.exe','binary'),'docx')
    def test_absolute_path_traversal(self):
        with self.assertRaises(ValueError):module.extract(self.archive('/etc/passwd','root:x:0:0'),'docx')
    def test_network_block(self):
        with self.assertRaises(RuntimeError):module.socket.socket()
if __name__=='__main__':unittest.main()
