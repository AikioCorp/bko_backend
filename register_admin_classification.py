import sys

file_path = r'c:\Dev\Projet\bamako-Podcast\Bko_backend\src\routes\v1\index.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

import_statement = 'import { AdminClassificationController } from "../../modules/admin/admin-classification.controller.js";\n'

if 'AdminClassificationController' not in content:
    content = content.replace('import { AdminConsoleController }', import_statement + 'import { AdminConsoleController }')

routes = '''
// --- ADMIN CATEGORIES & LANGUAGES ---
router.get("/admin/categories", authenticateToken, AdminClassificationController.listCategories);
router.post("/admin/categories", authenticateToken, requirePermission("catalog.create"), AdminClassificationController.createCategory);
router.put("/admin/categories/:id", authenticateToken, requirePermission("catalog.edit"), AdminClassificationController.updateCategory);

router.get("/admin/languages", authenticateToken, AdminClassificationController.listLanguages);
router.post("/admin/languages", authenticateToken, requirePermission("catalog.create"), AdminClassificationController.createLanguage);
router.put("/admin/languages/:code", authenticateToken, requirePermission("catalog.edit"), AdminClassificationController.updateLanguage);
'''

if '/admin/categories' not in content:
    content = content.replace("// --- CONSOLE D'ADMINISTRATION", routes + "\n// --- CONSOLE D'ADMINISTRATION")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
