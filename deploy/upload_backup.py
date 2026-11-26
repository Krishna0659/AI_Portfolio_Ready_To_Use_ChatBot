"""Upload encrypted backups using the VM's identity; no storage account keys."""
import datetime
import hashlib
import json
from pathlib import Path
import urllib.request
import urllib.error

metadata = 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F'
with urllib.request.urlopen(urllib.request.Request(metadata, headers={'Metadata': 'true'}), timeout=15) as response:
    token = json.load(response)['access_token']
base = 'https://portfoliobackup0659.blob.core.windows.net/snapshots'
headers = {'Authorization': 'Bearer '+token, 'x-ms-version': '2023-11-03',
           'x-ms-date': datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')}
try:
    urllib.request.urlopen(urllib.request.Request(base+'?restype=container', data=b'', headers=headers, method='PUT'), timeout=30).close()
except urllib.error.HTTPError as exc:
    if exc.code != 409:
        raise RuntimeError(f'Backup container creation failed: HTTP {exc.code}') from None
path = sorted(Path('/opt/portfolioai-backups').glob('*.tar.gz.enc'))[-1]
data = path.read_bytes()
digest = hashlib.sha256(data).hexdigest()
request = urllib.request.Request(base+'/'+path.name, data=data,
    headers={**headers, 'x-ms-blob-type': 'BlockBlob', 'x-ms-meta-sha256': digest}, method='PUT')
with urllib.request.urlopen(request, timeout=120) as response:
    if response.status != 201:
        raise RuntimeError('Backup upload did not succeed')
# Read back and hash the actual stored bytes, not only metadata.
with urllib.request.urlopen(urllib.request.Request(base+'/'+path.name, headers=headers), timeout=120) as response:
    if hashlib.sha256(response.read()).hexdigest() != digest:
        raise RuntimeError('Off-VM backup checksum mismatch')
print('Off-VM encrypted backup uploaded and read-back checksum verified:', path.name)
