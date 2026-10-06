import sys

file_path = r'c:\Dev\Projet\bamako-Podcast\Bko_backend\src\routes\v1\index.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

del_cat = 'router.delete("/admin/categories/:id", authenticateToken, requirePermission("catalog.delete"), AdminClassificationController.deleteCategory);\n'
del_lang = 'router.delete("/admin/languages/:code", authenticateToken, requirePermission("catalog.delete"), AdminClassificationController.deleteLanguage);\n'

if 'deleteCategory' not in content:
    content = content.replace('AdminClassificationController.updateCategory);', 'AdminClassificationController.updateCategory);\n' + del_cat)
if 'deleteLanguage' not in content:
    content = content.replace('AdminClassificationController.updateLanguage);', 'AdminClassificationController.updateLanguage);\n' + del_lang)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
