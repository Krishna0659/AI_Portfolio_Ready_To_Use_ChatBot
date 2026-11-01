import sys, os, io, json, zipfile, socket
# Local parser has no application credentials. Production must additionally enforce OS/container network isolation.
sys.path.insert(0, os.path.join(os.getcwd(), '.local', 'python-packages'))
from defusedxml import ElementTree
from bs4 import BeautifulSoup
from pypdf import PdfReader
def blocked(*a, **kw): raise RuntimeError('Parser networking is disabled')
socket.socket = blocked
def extract(data, kind):
    if len(data)>10485760: raise ValueError('File exceeds 10 MB')
    if kind=='docx':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            entries=z.infolist()
            if len(entries)>1000 or sum(i.file_size for i in entries)>30*1024*1024: raise ValueError('Expanded document exceeds limits')
            for i in entries:
                if '..' in i.filename.split('/') or i.filename.startswith('/') or i.flag_bits & 1: raise ValueError('Unsafe archive')
                if i.file_size>10*1024*1024 or i.file_size/max(i.compress_size,1)>200: raise ValueError('Unsafe compression ratio')
                if 'vbaProject' in i.filename or '/embeddings/' in i.filename: raise ValueError('Embedded executable content is unsupported')
            root=ElementTree.fromstring(z.read('word/document.xml'))
            ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            text='\n'.join(''.join(p.itertext()) for p in root.findall('.//w:p',ns))
    elif kind=='pdf':
        if not data.startswith(b'%PDF-'): raise ValueError('Invalid PDF signature')
        reader=PdfReader(io.BytesIO(data),strict=True)
        if reader.is_encrypted or len(reader.pages)>100: raise ValueError('Encrypted or oversized PDF')
        root=reader.trailer['/Root']
        if '/OpenAction' in root or '/AA' in root or '/JavaScript' in root.get('/Names',{}): raise ValueError('Active PDF content is unsupported')
        text='\n'.join(page.extract_text() or '' for page in reader.pages)
    elif kind=='html':
        soup=BeautifulSoup(data,'html.parser')
        for item in soup(['script','style','nav','footer','header','noscript','svg','iframe','form']): item.decompose()
        text=soup.get_text('\n',strip=True)
    else: text=data.decode('utf-8-sig',errors='strict')
    text='\n'.join(line.strip() for line in text.splitlines() if line.strip())
    if not text or len(text)<20: raise ValueError('No usable text found; upload a text-based document instead')
    if len(text)>200000: raise ValueError('Extracted text exceeds 200,000 characters')
    return text
if __name__=='__main__':
    try: print(json.dumps({'text':extract(sys.stdin.buffer.read(10485761),sys.argv[1])}))
    except Exception as e: print(json.dumps({'error':str(e)}));sys.exit(1)
