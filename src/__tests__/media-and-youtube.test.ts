import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaResolverService } from '../modules/creator/media-resolver.service.js';
import { YouTubeResolverService } from '../modules/youtube/youtube-resolver.service.js';
import { UploadService } from '../modules/media/upload.service.js';

test('MediaResolverService: strictly validates legitimate YouTube video URLs', () => {
  // Test standard watch URL
  const res1 = MediaResolverService.resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(res1.provider, 'YOUTUBE');
  assert.equal(res1.externalId, 'dQw4w9WgXcQ');
  assert.equal(res1.externalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(res1.playbackMode, 'EMBED');

  // Test youtu.be short URL
  const res2 = MediaResolverService.resolveUrl('https://youtu.be/dQw4w9WgXcQ?t=42');
  assert.equal(res2.provider, 'YOUTUBE');
  assert.equal(res2.externalId, 'dQw4w9WgXcQ');

  // Test shorts URL
  const res3 = MediaResolverService.resolveUrl('https://youtube.com/shorts/dQw4w9WgXcQ');
  assert.equal(res3.provider, 'YOUTUBE');
  assert.equal(res3.externalId, 'dQw4w9WgXcQ');

  // Test live URL
  const res4 = MediaResolverService.resolveUrl('https://m.youtube.com/live/dQw4w9WgXcQ?feature=share');
  assert.equal(res4.provider, 'YOUTUBE');
  assert.equal(res4.externalId, 'dQw4w9WgXcQ');

  // Test embed URL with query parameter order variation
  const res5 = MediaResolverService.resolveUrl('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&autoplay=1');
  assert.equal(res5.provider, 'YOUTUBE');
  assert.equal(res5.externalId, 'dQw4w9WgXcQ');
});

test('MediaResolverService: rejects deceptive domains mimicking YouTube', () => {
  assert.throws(
    () => {
      MediaResolverService.resolveUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ');
    },
    /INVALID_YOUTUBE_URL/
  );

  assert.throws(
    () => {
      MediaResolverService.resolveUrl('https://youtube.com.attacker.com/watch?v=dQw4w9WgXcQ');
    },
    /INVALID_YOUTUBE_URL/
  );
});

test('MediaResolverService: protects against SSRF attacks on URL imports', () => {
  assert.throws(
    () => {
      MediaResolverService.resolveUrl('http://127.0.0.1/private-audio.mp3');
    },
    /INVALID_URL/
  );

  assert.throws(
    () => {
      MediaResolverService.resolveUrl('http://localhost:8080/internal.mp3');
    },
    /INVALID_URL/
  );

  assert.throws(
    () => {
      MediaResolverService.resolveUrl('http://192.168.1.50/stream.mp3');
    },
    /INVALID_URL/
  );
});

test('YouTubeResolverService: rejects single video URLs and non-YouTube URLs in channel connector', () => {
  // Single video should be rejected with VIDEO_URL_NOT_CHANNEL
  assert.throws(
    () => {
      YouTubeResolverService.parseInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    },
    /VIDEO_URL_NOT_CHANNEL/
  );

  assert.throws(
    () => {
      YouTubeResolverService.parseInput('https://youtu.be/dQw4w9WgXcQ');
    },
    /VIDEO_URL_NOT_CHANNEL/
  );

  assert.throws(
    () => {
      YouTubeResolverService.parseInput('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    },
    /VIDEO_URL_NOT_CHANNEL/
  );

  // Deceptive or non-YouTube domain should be rejected with NOT_YOUTUBE_URL
  assert.throws(
    () => {
      YouTubeResolverService.parseInput('https://evil-youtube.com/@bamakopodcast');
    },
    /NOT_YOUTUBE_URL/
  );

  // Valid channel formats should be parsed
  const handleResult = YouTubeResolverService.parseInput('https://www.youtube.com/@bamakopodcast');
  assert.equal(handleResult.type, 'HANDLE');
  assert.equal(handleResult.value, '@bamakopodcast');

  const idResult = YouTubeResolverService.parseInput('UC1234567890123456789012');
  assert.equal(idResult.type, 'CHANNEL_ID');
  assert.equal(idResult.value, 'UC1234567890123456789012');
});

test('UploadService: rejects directory traversal, invalid sizes, and illegal folders', async () => {
  // Test folder traversal
  await assert.rejects(
    async () => {
      await UploadService.createImageUploadUrl('user-1', {
        folder: '../sensitive_secrets' as any,
        mimeType: 'image/png',
        sizeBytes: 1024,
      });
    },
    /Dossier de destination d'image invalide/
  );

  // Test zero or negative size
  await assert.rejects(
    async () => {
      await UploadService.createImageUploadUrl('user-1', {
        folder: 'covers',
        mimeType: 'image/png',
        sizeBytes: 0,
      });
    },
    /L'image dépasse la limite de 10 Mo ou est invalide/
  );

  // Test oversized image
  await assert.rejects(
    async () => {
      await UploadService.createImageUploadUrl('user-1', {
        folder: 'covers',
        mimeType: 'image/png',
        sizeBytes: 25 * 1024 * 1024, // 25 Mo > 10 Mo
      });
    },
    /L'image dépasse la limite de 10 Mo ou est invalide/
  );

  // Test unsupported MIME type
  await assert.rejects(
    async () => {
      await UploadService.createImageUploadUrl('user-1', {
        folder: 'covers',
        mimeType: 'application/x-executable',
        sizeBytes: 2048,
      });
    },
    /Format d'image non supporté/
  );
});
