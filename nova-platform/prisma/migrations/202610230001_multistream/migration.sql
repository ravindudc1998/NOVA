CREATE TABLE "RestreamDestination" (
  "id" UUID NOT NULL, "channelId" UUID NOT NULL,
  "provider" TEXT NOT NULL, "name" TEXT NOT NULL, "serverUrl" TEXT NOT NULL, "encryptedKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "maxHeight" INTEGER NOT NULL DEFAULT 720,
  "version" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'waiting', "errorCode" TEXT,
  "sessionId" UUID, "statusVersion" INTEGER NOT NULL DEFAULT 0, "lastHeartbeatAt" TIMESTAMP(3), "startedAt" TIMESTAMP(3),
  "bitrateKbps" INTEGER NOT NULL DEFAULT 0, "bytesSent" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestreamDestination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestreamDestination_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestreamDestination_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StreamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "RestreamDestination_channelId_createdAt_idx" ON "RestreamDestination"("channelId", "createdAt");
CREATE INDEX "RestreamDestination_enabled_createdAt_idx" ON "RestreamDestination"("enabled", "createdAt");
INSERT INTO "Permission" ("code","description") VALUES
 ('restreams.manage_own','Manage own external stream destinations'),
 ('restreams.manage_any','Manage all external stream destinations') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "GroupPermission" ("groupId","permissionCode")
 SELECT "id",'restreams.manage_own' FROM "Group" WHERE "key"='creators'
 ON CONFLICT ("groupId","permissionCode") DO NOTHING;
