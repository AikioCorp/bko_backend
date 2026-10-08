const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../prisma/migrations");
try {
  const directories = fs.readdirSync(root, {withFileTypes:true}).filter(item=>item.isDirectory());
  if (!directories.length) throw new Error("Aucune migration trouvée.");
  for (const directory of directories) {
    const file = path.join(root,directory.name,"migration.sql");
    try {
      if (!fs.readFileSync(file,"utf8").trim()) throw new Error("fichier vide");
    } catch (error) {
      throw new Error(`Migration illisible : ${file} (${error.message}). Vérifiez que les volumes de déploiement ne masquent pas /app/prisma.`);
    }
  }
  console.log(`[Migration] ${directories.length} fichiers SQL vérifiés dans ${root}.`);
} catch(error) {
  console.error(`[Migration] ${error.message}`);
  process.exitCode=1;
}
