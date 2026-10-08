import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {LocalMockStorageProvider} from '../src/services/storage/local-mock-storage.provider.js';
test('local uploads retain actual bytes, require a ticket and survive provider restart',async()=>{
 const storage=new LocalMockStorageProvider();const key=`tests/${Date.now()}-audio.mp3`;
 try {
  assert.equal(await storage.objectExists(key),false);
  const signed=await storage.createPresignedUploadUrl(key,'audio/mpeg');
  assert.equal(await storage.objectExists(key),false);
  const token=new URL(signed.uploadUrl).searchParams.get('token')!;
  await storage.receiveUpload(token,Readable.from(Buffer.from('real-media-bytes')));
  assert.equal((await storage.getMetadata(key))!.sizeBytes,16n);
  assert.equal((await readFile(storage.filePath(key))).toString(),'real-media-bytes');
  assert.equal(await new LocalMockStorageProvider().objectExists(key),true);
  await assert.rejects(()=>storage.receiveUpload(token,Readable.from('again')));
  assert.throws(()=>storage.filePath('../escape.mp3'));
 }finally{await storage.deleteObject(key);}
});
