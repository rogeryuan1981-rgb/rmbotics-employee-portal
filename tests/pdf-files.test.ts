import test from 'node:test';
import assert from 'node:assert/strict';
import { isOneDriveShareLink, materialFilePath, validatePdfFile, validatePdfUrl } from '../src/training/pdf-files';

test('rejects OneDrive sharing pages with an actionable upload instruction',()=>{
  const shared='https://example-my.sharepoint.com/:b:/g/personal/test/file';
  assert.equal(isOneDriveShareLink(shared),true);
  assert.throws(()=>validatePdfUrl(shared),/下載 PDF.*上傳 PDF/);
  assert.throws(()=>validatePdfUrl('https://1drv.ms/b/example'),/OneDrive/);
  assert.equal(validatePdfUrl(' https://example.test/material.pdf '),'https://example.test/material.pdf');
  assert.throws(()=>validatePdfUrl('http://example.test/a.pdf'),/HTTPS/);
});
test('only recognizes files on this project and in the private material bucket',()=>{
  const project='https://example.supabase.co';
  const object='12345678-1234-1234-1234-123456789012/12345678-1234-1234-1234-123456789013.pdf';
  const suffix='/storage/v1/object/authenticated/training-materials/'+object;
  assert.equal(materialFilePath(project+suffix,project),object);
  assert.equal(materialFilePath('https://attacker.test'+suffix,project),null);
  assert.equal(materialFilePath(project+suffix.replace('training-materials','other'),project),null);
  assert.equal(materialFilePath(project+suffix.replace(object,'../secret.pdf'),project),null);
});
test('checks PDF bytes instead of trusting a file extension or supplied MIME type',async()=>{
  await validatePdfFile(new File(['%PDF-1.7\n'],'test.PDF',{type:'application/octet-stream'}));
  await assert.rejects(validatePdfFile(new File(['<html>login</html>'],'test.pdf',{type:'application/pdf'})),/不是有效的 PDF/);
  await assert.rejects(validatePdfFile(new File([''],'test.pdf')),/大小/);
  await assert.rejects(validatePdfFile(new File(['%PDF-'],'test.html')),/選擇 PDF/);
  await assert.rejects(validatePdfFile(new File([new Uint8Array(20*1024*1024+1)],'big.pdf')),/20 MB/);
});
