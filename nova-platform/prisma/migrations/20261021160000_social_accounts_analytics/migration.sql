ALTER TABLE "User" ADD COLUMN "bio" TEXT NOT NULL DEFAULT '', ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "authNotBefore" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "authAllowedSessionId" TEXT;
ALTER TABLE "StreamSession" ADD COLUMN "title" TEXT, ADD COLUMN "analyticsStartedAt" TIMESTAMP(3), ADD COLUMN "lastAnalyticsAt" TIMESTAMP(3);
CREATE TABLE "Follow" (
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "notifyLive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId","channelId")
);
CREATE INDEX "Follow_channelId_userId_idx" ON "Follow"("channelId","userId");
CREATE TABLE "FollowActivity" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('follow','unfollow')), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FollowActivity_channelId_createdAt_idx" ON "FollowActivity"("channelId","createdAt");
CREATE TABLE "LiveNotificationEvent" (
 "sessionId" UUID PRIMARY KEY REFERENCES "StreamSession"("id") ON DELETE CASCADE,
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "cursor" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3)
);
CREATE INDEX "LiveNotificationEvent_processedAt_createdAt_idx" ON "LiveNotificationEvent"("processedAt","createdAt");
CREATE TABLE "Notification" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "sessionId" UUID NOT NULL REFERENCES "StreamSession"("id") ON DELETE CASCADE,
 "title" TEXT NOT NULL, "creatorName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
 UNIQUE ("userId","sessionId")
);
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId","createdAt");
CREATE TABLE "AudienceSample" (
 "sessionId" UUID NOT NULL REFERENCES "StreamSession"("id") ON DELETE CASCADE, "bucketAt" TIMESTAMP(3) NOT NULL,
 "viewerSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0, "observedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
 PRIMARY KEY ("sessionId","bucketAt"), CHECK ("viewerSeconds">=0 AND "observedSeconds">=0)
);
CREATE INDEX "AudienceSample_bucketAt_idx" ON "AudienceSample"("bucketAt");
CREATE TABLE "RevokedSession" (
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "sessionId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("userId","sessionId")
);
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
INSERT INTO "Permission" ("code","description") VALUES ('analytics.read_own','Read own channel analytics'),('analytics.read_any','Read platform and channel analytics') ON CONFLICT DO NOTHING;
INSERT INTO "GroupPermission" ("groupId","permissionCode") SELECT "id",'analytics.read_own' FROM "Group" WHERE "key"='creators' ON CONFLICT DO NOTHING;
