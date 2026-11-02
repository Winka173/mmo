"""No network or model inference: check official LFS/Git object integrity paths."""
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('acs_install_model',Path(__file__).with_name('install-model.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class OfficialCheckpointIntegrity(unittest.TestCase):
 def test_git_blob_and_lfs_hashes(self):
  with tempfile.TemporaryDirectory(prefix='acs-official-checksum-') as temporary:
   file=Path(temporary)/'fixture.json';payload=b'{"fixture":true}';file.write_bytes(payload)
   blob=hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()
   git=SimpleNamespace(rfilename=file.name,size=len(payload),lfs=None,blob_id=blob)
   self.assertTrue(module.verify_official_file(file,git)['official_checksum_verified'])
   lfs=SimpleNamespace(rfilename=file.name,size=len(payload),lfs=SimpleNamespace(sha256=hashlib.sha256(payload).hexdigest()),blob_id=blob)
   self.assertTrue(module.verify_official_file(file,lfs)['official_checksum_verified'])
   file.write_bytes(b'x'*len(payload))
   with self.assertRaisesRegex(ValueError,'Git blob checksum mismatch'):module.verify_official_file(file,git)
   with self.assertRaisesRegex(ValueError,'SHA-256 mismatch'):module.verify_official_file(file,lfs)

if __name__=='__main__':unittest.main()
