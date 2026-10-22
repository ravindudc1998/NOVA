CREATE TABLE "Category" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "slug" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL UNIQUE, "description" TEXT NOT NULL DEFAULT '',
 "enabled" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "Category" ("slug","name") VALUES
 ('general','General'),('gaming','Gaming'),('just-chatting','Just Chatting'),
 ('music','Music'),('education','Education'),('sports','Sports'),('creative','Creative'),('technology','Technology');
-- Retain existing free-text categories and the configured platform default.
INSERT INTO "Category" ("slug","name")
 SELECT 'legacy-' || md5(name), name FROM (
  SELECT DISTINCT COALESCE(NULLIF(BTRIM("settings"->>'category'),''),'General') AS name FROM "Channel"
  UNION SELECT COALESCE(NULLIF(BTRIM("value" #>> '{}'),''),'General') FROM "Setting" WHERE "key"='defaultCategory'
 ) legacy WHERE NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."name"=legacy.name)
 ON CONFLICT DO NOTHING;
ALTER TABLE "Channel" ADD COLUMN "categoryId" UUID REFERENCES "Category"("id") ON DELETE SET NULL;
UPDATE "Channel" ch SET "categoryId"=c."id" FROM "Category" c
 WHERE c."name"=COALESCE(NULLIF(BTRIM(ch."settings"->>'category'),''),(SELECT "value" #>> '{}' FROM "Setting" WHERE "key"='defaultCategory'),'General');
CREATE INDEX "Channel_categoryId_state_idx" ON "Channel"("categoryId","state");
CREATE TABLE "ChannelAsset" (
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL, "revision" TEXT NOT NULL, "bytes" BYTEA NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("channelId","kind"), CHECK ("kind" IN ('avatar','banner','offline')),
 CHECK (octet_length("bytes") <= 1048576)
);
CREATE TABLE "ChatRestriction" (
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('ban','timeout')), "reason" TEXT NOT NULL DEFAULT '',
 "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "actorId" TEXT NOT NULL,
 PRIMARY KEY ("channelId","userId"), CHECK (("kind"='ban' AND "expiresAt" IS NULL) OR ("kind"='timeout' AND "expiresAt" IS NOT NULL))
);
CREATE INDEX "ChatRestriction_channelId_expiresAt_idx" ON "ChatRestriction"("channelId","expiresAt");
CREATE TABLE "ChannelModerator" (
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("channelId","userId")
);
CREATE TABLE "ChatRules" (
 "channelId" UUID PRIMARY KEY REFERENCES "Channel"("id") ON DELETE CASCADE,
 "blockedWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "version" INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE "ChatReport" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "channelId" UUID NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
 "reporterId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "messageId" INTEGER NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
 "reason" TEXT NOT NULL, "details" TEXT NOT NULL DEFAULT '', "snapshot" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','resolved','dismissed')),
 "resolution" TEXT NOT NULL DEFAULT '', "reviewerId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3),
 UNIQUE ("reporterId","messageId")
);
CREATE INDEX "ChatReport_channelId_status_createdAt_idx" ON "ChatReport"("channelId","status","createdAt");
CREATE INDEX "ChatReport_reporterId_createdAt_idx" ON "ChatReport"("reporterId","createdAt");
