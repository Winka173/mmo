"""Network-free tests for bounded checkpoint transfer; not model inference evidence."""
import contextlib
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('image_download',Path(__file__).with_name('install-image.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Response:
    status=206
    def __init__(self,data,start,end,total):self.data=data;self.headers={'Content-Range':f'bytes {start}-{end}/{total}'}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,count):return self.data[:count]

class DownloadTests(unittest.TestCase):
    def test_resumes_contiguous_partial_and_validates_official_hash(self):
        data=bytes(range(256))*170000;name='transformer/fixture.safetensors'
        with tempfile.TemporaryDirectory() as folder:
            module.DEST=Path(folder);target=module.DEST/name;target.parent.mkdir();partial=target.with_name(target.name+'.acs-partial');prefix=5*1024*1024;partial.write_bytes(data[:prefix]);ranges=[]
            def request(req,timeout):
                start,end=map(int,req.headers['Range'][6:].split('-'));ranges.append((start,end));return Response(data[start:end+1],start,end,len(data))
            with patch.object(module.urllib.request,'urlopen',request):module.download({'rfilename':name,'size':len(data),'lfs':{'sha256':hashlib.sha256(data).hexdigest()}})
            self.assertEqual(target.read_bytes(),data);self.assertEqual(min(start for start,end in ranges),prefix);self.assertFalse(partial.exists());self.assertTrue(all(end-start+1<=16*1024*1024 for start,end in ranges))
    def test_refuses_incomplete_chunks_and_path_escape_without_publishing_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            module.DEST=Path(folder);size=5*1024*1024
            def incomplete(req,timeout):return Response(b'bad',0,size-1,size)
            with patch.object(module.urllib.request,'urlopen',incomplete),patch.object(module.time,'sleep'):
                with self.assertRaisesRegex(ValueError,'Incomplete'):module.download({'rfilename':'transformer/bad.safetensors','size':size})
            self.assertFalse((module.DEST/'transformer/bad.safetensors').exists())
            with self.assertRaisesRegex(ValueError,'destination'):module.download({'rfilename':'../escaped.bin','size':size})

if __name__=='__main__':unittest.main()
