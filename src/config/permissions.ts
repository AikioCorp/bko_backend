// Catalogue des permissions de la console d'administration (source unique de vérité).
// Une permission = "<fonctionnalité>.<capacité>". Le SUPER_ADMIN les possède toutes, implicitement.
// Le serveur applique ces permissions sur chaque route /admin/* ; la console masque les pages sans accès.

export type Capability = "view" | "create" | "edit" | "delete";

export interface Feature {
  key: string;
  label: string;
  description: string;
  caps: Capability[];
}

export const FEATURES: Feature[] = [
  { key: "dashboard", label: "Supervision & métriques", description: "Tableau de bord, indicateurs globaux", caps: ["view"] },
  { key: "catalog", label: "Podcasts & séries", description: "Catalogue, personnes, organisations, collections, fusions", caps: ["view", "create", "edit"] },
  { key: "reviews", label: "Validation des contenus", description: "Valider ou refuser les contenus soumis par les créateurs", caps: ["view", "edit"] },
  { key: "moderation", label: "Modération & signalements", description: "Traiter les signalements, retirer un contenu", caps: ["view", "edit"] },
  { key: "claims", label: "Revendications", description: "Examiner les demandes de propriété de podcast", caps: ["view", "edit"] },
  { key: "users", label: "Créateurs & utilisateurs", description: "Comptes : consulter, suspendre, attribuer des rôles, créateur de confiance", caps: ["view", "edit"] },
  { key: "roles", label: "Rôles & permissions", description: "Créer et configurer les rôles de la console", caps: ["view", "create", "edit", "delete"] },
  { key: "markets", label: "Marchés", description: "Ouverture des pays, accès des créateurs", caps: ["view", "edit"] },
  { key: "storage", label: "Stockage & tâches", description: "Stockage média, file de traitement, relance des tâches", caps: ["view", "edit"] },
  { key: "settings", label: "Configuration", description: "État des fonctionnalités et des services (lecture seule)", caps: ["view"] },
  { key: "audit", label: "Journal d'audit", description: "Historique des actions d'administration", caps: ["view"] },
];

export const ALL_PERMISSIONS: string[] = FEATURES.flatMap((f) => f.caps.map((c) => `${f.key}.${c}`));

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

// Rôles fournis avec la plateforme. `preset` n'est appliqué qu'à la première initialisation :
// ensuite, la configuration faite dans la console fait foi.
export const SYSTEM_ROLES: { name: string; description: string; preset: string[] }[] = [
  { name: "USER", description: "Auditeur", preset: [] },
  { name: "CREATOR", description: "Créateur de contenu", preset: [] },
  { name: "SUPER_ADMIN", description: "Super administrateur (tous les droits)", preset: [] },
  { name: "ADMIN", description: "Administrateur", preset: ALL_PERMISSIONS.filter((p) => p !== "roles.delete") },
  {
    name: "EDITOR",
    description: "Éditeur",
    preset: ["dashboard.view", "catalog.view", "catalog.create", "catalog.edit", "reviews.view", "reviews.edit", "moderation.view", "moderation.edit", "claims.view", "claims.edit", "markets.view", "storage.view"],
  },
];

// Modèles proposés à la création d'un rôle (modifiables avant enregistrement).
export const ROLE_TEMPLATES: { key: string; name: string; description: string; permissions: string[] }[] = [
  {
    key: "moderator",
    name: "MODERATEUR",
    description: "Modérateur",
    permissions: ["dashboard.view", "moderation.view", "moderation.edit", "reviews.view"],
  },
  {
    key: "editorial",
    name: "RESPONSABLE_EDITORIAL",
    description: "Responsable éditorial",
    permissions: ["dashboard.view", "catalog.view", "catalog.create", "catalog.edit", "reviews.view", "reviews.edit", "claims.view", "claims.edit"],
  },
  {
    key: "market",
    name: "GESTIONNAIRE_MARCHE",
    description: "Gestionnaire de marché",
    permissions: ["dashboard.view", "markets.view", "markets.edit", "users.view"],
  },
  {
    key: "support",
    name: "SUPPORT",
    description: "Support",
    permissions: ["dashboard.view", "users.view", "storage.view"],
  },
  {
    key: "tech",
    name: "RESPONSABLE_TECHNIQUE",
    description: "Responsable technique",
    permissions: ["dashboard.view", "storage.view", "storage.edit", "settings.view", "audit.view"],
  },
  {
    key: "analyst",
    name: "ANALYSTE",
    description: "Analyste (lecture seule)",
    permissions: ["dashboard.view", "catalog.view", "moderation.view", "reviews.view", "markets.view", "storage.view"],
  },
];

export const isValidPermission = (p: string) => ALL_PERMISSIONS.includes(p);
