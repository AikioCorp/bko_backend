CREATE TABLE "SupportTicket" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT,
 "email" TEXT NOT NULL,
 "subject" TEXT NOT NULL,
 "category" TEXT NOT NULL DEFAULT 'GENERAL',
 "origin" TEXT NOT NULL DEFAULT 'WEB',
 "status" TEXT NOT NULL DEFAULT 'OPEN',
 "accessHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "SupportMessage" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "ticketId" TEXT NOT NULL REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "authorId" TEXT,
 "kind" TEXT NOT NULL DEFAULT 'USER',
 "body" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- Preserve authenticated requests previously stored only in the audit journal.
INSERT INTO "SupportTicket" ("id","userId","email","subject","category","origin","accessHash","createdAt","updatedAt")
SELECT a."id",a."actorId",u."email",COALESCE(a."newState"->>'subject','Demande d’assistance'),COALESCE(a."newState"->>'category','GENERAL'),'LEGACY','',a."createdAt",a."createdAt"
FROM "AuditLog" a JOIN "User" u ON u."id"=a."actorId"
WHERE a."action"='SUPPORT_REQUEST_SUBMITTED';
INSERT INTO "SupportMessage" ("id","ticketId","authorId","body","createdAt")
SELECT 'legacy-'||a."id",a."id",a."actorId",COALESCE(a."newState"->>'description','Demande enregistrée précédemment.'),a."createdAt"
FROM "AuditLog" a JOIN "SupportTicket" t ON t."id"=a."id"
WHERE a."action"='SUPPORT_REQUEST_SUBMITTED';
