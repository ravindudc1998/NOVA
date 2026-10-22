CREATE TABLE "StreamSession" (
 "id" UUID NOT NULL, "channelId" UUID NOT NULL, "publisherId" TEXT NOT NULL, "protocol" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'starting', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3), "endReason" TEXT,
 CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "StreamSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StreamSession_channelId_createdAt_idx" ON "StreamSession"("channelId","createdAt");
-- Enforce one active publisher even if concurrent API requests reach different processes.
CREATE UNIQUE INDEX "StreamSession_one_active_channel" ON "StreamSession"("channelId") WHERE "endedAt" IS NULL;
CREATE TABLE "ChatMessage" (
 "id" SERIAL NOT NULL, "roomId" UUID NOT NULL, "authorId" UUID, "clientMessageId" UUID NOT NULL,
 "displayName" TEXT NOT NULL, "text" TEXT NOT NULL, "deleted" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatMessage_authorId_clientMessageId_key" ON "ChatMessage"("authorId","clientMessageId");
CREATE INDEX "ChatMessage_roomId_id_idx" ON "ChatMessage"("roomId","id");
CREATE INDEX "ChatMessage_roomId_authorId_createdAt_idx" ON "ChatMessage"("roomId","authorId","createdAt");
