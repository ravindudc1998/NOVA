ALTER TABLE "Channel" ADD COLUMN "publishingPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatRoom" ADD COLUMN "epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatMessage" ADD COLUMN "epoch" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "ChatMessage_roomId_epoch_id_idx" ON "ChatMessage"("roomId","epoch","id");
ALTER TABLE "ChatReport" DROP CONSTRAINT "ChatReport_messageId_fkey";
ALTER TABLE "ChatReport" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "ChatArchiveBatch" (
 "id" UUID PRIMARY KEY,"roomId" UUID NOT NULL,"channelId" UUID NOT NULL,"slug" TEXT NOT NULL,"title" TEXT NOT NULL,"epoch" INTEGER NOT NULL,"endedAt" TIMESTAMP(3) NOT NULL,"completedAt" TIMESTAMP(3)
);
CREATE INDEX "ChatArchiveBatch_completedAt_endedAt_idx" ON "ChatArchiveBatch"("completedAt","endedAt");
