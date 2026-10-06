import sys

file_path = r'c:\Dev\Projet\bamako-Podcast\Bko_backend\src\routes\v1\index.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

import_statement = 'import { AdminRssController } from "../../modules/admin/admin-rss.controller.js";\n'

if 'AdminRssController' not in content:
    content = content.replace('import { AdminClassificationController }', import_statement + 'import { AdminClassificationController }')

routes = '''
// --- ADMIN RSS IMPORTS ---
router.post("/admin/rss/preview", authenticateToken, requirePermission("catalog.create"), AdminRssController.previewRss);
router.post("/admin/rss/imports", authenticateToken, requirePermission("catalog.create"), AdminRssController.createImport);
router.get("/admin/rss/imports/:id", authenticateToken, requirePermission("catalog.view"), AdminRssController.getImportStatus);
'''

if '/admin/rss/preview' not in content:
    content = content.replace('// --- ADMIN CATEGORIES & LANGUAGES ---', routes + '\n// --- ADMIN CATEGORIES & LANGUAGES ---')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
