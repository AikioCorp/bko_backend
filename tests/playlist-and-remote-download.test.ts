import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../src/config/prisma.js";
import { PlaylistService } from "../src/modules/playlists/playlist.service.js";
import { DownloadService } from "../src/modules/downloads/download.service.js";

test("PlaylistService & DownloadService lifecycle", async () => {
  // Trouver ou créer un utilisateur de test
  let user = await prisma.user.findFirst({
    where: { email: { contains: "test" } },
  });

  if (!user) {
    user = await prisma.user.findFirst();
  }

  if (!user) {
    // Si aucun utilisateur en base, on saute le test DB
    return;
  }

  const userId = user.id;

  // 1. Validation : Création sans nom doit échouer
  await assert.rejects(
    async () => {
      await PlaylistService.createPlaylist(userId, { name: "   " });
    },
    { message: "Le nom de la playlist est obligatoire" }
  );

  // 2. Création avec isPublic = false -> visibilité PRIVATE
  const playlistName = `Playlist Test ${Date.now()}`;
  const playlist = await PlaylistService.createPlaylist(userId, {
    name: playlistName,
    isPublic: false,
    description: "Description test",
  });

  assert.equal(playlist.name, playlistName);
  assert.equal(playlist.visibility, "PRIVATE");
  assert.equal(playlist.description, "Description test");

  try {
    // 3. Récupération des playlists de l'utilisateur
    const userPlaylists = await PlaylistService.getUserPlaylists(userId);
    const found = userPlaylists.find((p) => p.id === playlist.id);
    assert.ok(found, "La playlist créée doit être présente dans les playlists de l'utilisateur");

    // 4. Ajout d'un épisode (si existant)
    const episode = await prisma.episode.findFirst();
    if (episode) {
      const item = await PlaylistService.addItemToPlaylist(userId, playlist.id, episode.id);
      assert.ok(item);
      assert.equal(item.episodeId, episode.id);

      // Idempotence : ajouter le même épisode ne doit pas créer de doublon
      const itemDuplicate = await PlaylistService.addItemToPlaylist(userId, playlist.id, episode.id);
      assert.equal(itemDuplicate.id, item.id);

      // Récupération par ID
      const fullPlaylist = await PlaylistService.getPlaylistById(playlist.id, userId);
      assert.equal(fullPlaylist.items.length, 1);
      assert.equal(fullPlaylist.items[0].episodeId, episode.id);

      // Suppression de l'élément
      await PlaylistService.removeItemFromPlaylist(userId, playlist.id, episode.id);
      const afterRemoval = await PlaylistService.getPlaylistById(playlist.id, userId);
      assert.equal(afterRemoval.items.length, 0);
    }

    // 5. DownloadService : Test du statut appareil sans mobile
    // Pour ce test, si aucun mobile récent n'existe, hasActiveMobile doit être false ou true selon l'état
    const statusBefore = await DownloadService.getMobileDeviceStatus(userId);
    assert.ok(typeof statusBefore.hasActiveMobile === "boolean");

    // 6. Enregistrement d'un appareil mobile actif
    const syncedDevice = await DownloadService.syncDevice(userId, {
      deviceType: "MOBILE",
      deviceName: "Pixel 8 Pro Test",
      osVersion: "Android 14",
      appVersion: "1.0.0",
      deviceFingerprint: `test-fingerprint-${Date.now()}`,
    });
    assert.ok(syncedDevice.id);
    assert.equal(syncedDevice.deviceType, "MOBILE");

    const statusAfter = await DownloadService.getMobileDeviceStatus(userId);
    assert.equal(statusAfter.hasActiveMobile, true);
    assert.equal(statusAfter.device?.deviceName, "Pixel 8 Pro Test");

    // 7. Envoi d'un ordre de téléchargement distant vers ce mobile
    if (episode) {
      const queueResult = await DownloadService.queueRemoteDownload(userId, episode.id, "WEB");
      assert.equal(queueResult.queued, true);
      assert.equal(queueResult.hasActiveMobile, true);

      // 8. Récupération des téléchargements en attente (côté mobile)
      const pendingDownloads = await DownloadService.getPendingRemoteDownloads(userId);
      const pendingItem = pendingDownloads.find((p: any) => p.episodeId === episode.id);
      assert.ok(pendingItem, "L'ordre de téléchargement doit être présent dans la file du mobile");

      // 9. Acquittement par le mobile
      if (pendingItem) {
        await DownloadService.ackRemoteDownload(userId, pendingItem.queueId, "COMPLETED");
        const afterAck = await DownloadService.getPendingRemoteDownloads(userId);
        assert.ok(!afterAck.some((p: any) => p.queueId === pendingItem.queueId));
      }
    }

    // Nettoyage de l'appareil de test
    await prisma.device.delete({ where: { id: syncedDevice.id } }).catch(() => {});
  } finally {
    // Nettoyage de la playlist de test
    await PlaylistService.deletePlaylist(userId, playlist.id).catch(() => {});
  }
});
