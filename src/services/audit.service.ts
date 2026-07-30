import { prisma } from "../config/prisma.js";

export class AuditService {
  static async logAction(data: {
    actorId?: string;
    action: string;
    entityType: string;
    entityId: string;
    previousState?: any;
    newState?: any;
    ipAddress?: string;
  }) {
    try {
      return await prisma.auditLog.create({
        data: {
          actorId: data.actorId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          previousState: data.previousState ? JSON.parse(JSON.stringify(data.previousState)) : undefined,
          newState: data.newState ? JSON.parse(JSON.stringify(data.newState)) : undefined,
          ipAddress: data.ipAddress,
        },
      });
    } catch (e) {
      console.error("Erreur d'écriture d'AuditLog:", e);
    }
  }
}
