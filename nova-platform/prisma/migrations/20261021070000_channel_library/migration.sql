CREATE TABLE "FavouriteChannel" (
  "userId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FavouriteChannel_pkey" PRIMARY KEY ("userId", "channelId")
);
CREATE TABLE "RecentChannel" (
  "userId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecentChannel_pkey" PRIMARY KEY ("userId", "channelId")
);
CREATE INDEX "FavouriteChannel_userId_createdAt_idx" ON "FavouriteChannel"("userId", "createdAt");
CREATE INDEX "RecentChannel_userId_lastViewedAt_idx" ON "RecentChannel"("userId", "lastViewedAt");
ALTER TABLE "FavouriteChannel" ADD CONSTRAINT "FavouriteChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavouriteChannel" ADD CONSTRAINT "FavouriteChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecentChannel" ADD CONSTRAINT "RecentChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecentChannel" ADD CONSTRAINT "RecentChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("code", "description") VALUES ('favourites.manage_own', 'Manage own favourite channels')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";
INSERT INTO "GroupPermission" ("groupId", "permissionCode")
SELECT "id", 'favourites.manage_own' FROM "Group" WHERE "key" IN ('viewers', 'moderators')
ON CONFLICT DO NOTHING;
