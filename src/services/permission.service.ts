import { prisma } from "../config/prisma.js";
import { ALL_PERMISSIONS, SUPER_ADMIN_ROLE, SYSTEM_ROLES } from "../config/permissions.js";

export interface Access {
  isSuper: boolean;
  permissions: Set<string>;
  roles: string[];
}

// Cache court : évite une requête SQL par appel tout en propageant vite un retrait de droits.
const TTL_MS = 15_000;
const cache = new Map<string, { exp: number; access: Access }>();

export class PermissionService {
  static invalidate(userId?: string) {
    if (userId) cache.delete(userId);
    else cache.clear();
  }

  static async getAccess(userId: string): Promise<Access> {
    const hit = cache.get(userId);
    if (hit && hit.exp > Date.now()) return hit.access;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isSuspended: true } });
    if (!user || user.isSuspended) {
      const none = { isSuper: false, permissions: new Set<string>(), roles: [] as string[] };
      cache.set(userId, { exp: Date.now() + TTL_MS, access: none });
      return none;
    }
    const rows = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    const roles = rows.map((r) => r.role.name);
    const isSuper = roles.some((r) => r.toUpperCase() === SUPER_ADMIN_ROLE);
    const permissions = new Set<string>(
      isSuper ? ALL_PERMISSIONS : rows.flatMap((r) => r.role.rolePermissions.map((rp) => rp.permission.code))
    );
    const access = { isSuper, permissions, roles };
    cache.set(userId, { exp: Date.now() + TTL_MS, access });
    return access;
  }

  /** Une personne a accès à la console dès qu'elle détient au moins une permission. */
  static hasConsoleAccess(access: Access) {
    return access.permissions.size > 0;
  }

  /** Permissions effectives d'un ensemble de rôles (pour comparer des niveaux de droits). */
  static async permissionsOfRoleNames(names: string[]): Promise<Set<string>> {
    const roles = await prisma.role.findMany({
      where: { name: { in: names } },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (roles.some((r) => r.name.toUpperCase() === SUPER_ADMIN_ROLE)) return new Set(ALL_PERMISSIONS);
    return new Set(roles.flatMap((r) => r.rolePermissions.map((rp) => rp.permission.code)));
  }

  /**
   * Initialisation idempotente, au démarrage : synchronise le catalogue de permissions et
   * crée les rôles système. Le préréglage d'un rôle n'est appliqué qu'une seule fois
   * (presetApplied) : les changements faits ensuite dans la console ne sont jamais écrasés.
   */
  static async bootstrap() {
    for (const code of ALL_PERMISSIONS) {
      await prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: code } });
    }
    // Retire les permissions qui ne sont plus au catalogue.
    await prisma.permission.deleteMany({ where: { code: { notIn: ALL_PERMISSIONS } } });

    const perms = await prisma.permission.findMany();
    const idByCode = new Map(perms.map((p) => [p.code, p.id]));

    for (const def of SYSTEM_ROLES) {
      const role = await prisma.role.upsert({
        where: { name: def.name },
        update: { isSystem: true },
        create: { name: def.name, description: def.description, isSystem: true },
      });
      if (!role.presetApplied) {
        await prisma.$transaction([
          prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
          prisma.rolePermission.createMany({
            data: def.preset.map((code) => ({ roleId: role.id, permissionId: idByCode.get(code)! })),
            skipDuplicates: true,
          }),
          prisma.role.update({ where: { id: role.id }, data: { presetApplied: true } }),
        ]);
      }
    }
  }
}
