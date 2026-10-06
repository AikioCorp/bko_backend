import sys

file_path = r'c:\Dev\Projet\bamako-Podcast\Bko_backend\src\modules\admin\admin-classification.controller.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

delete_category = """
  static async deleteCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const count = await prisma.podcastCategory.count({ where: { categoryId: id } });
      if (count > 0) return sendError(res, "Impossible de supprimer une catégorie associée à des podcasts.");
      
      await prisma.category.delete({ where: { id } });
      return sendSuccess(res, { deleted: true });
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }

  // --- Languages ---"""

content = content.replace('  // --- Languages ---', delete_category)

delete_language = """
  static async deleteLanguage(req: Request, res: Response) {
    try {
      const { code } = req.params;
      const primaryCount = await prisma.podcast.count({ where: { primaryLanguageCode: code } });
      const secondaryCount = await prisma.podcastLanguage.count({ where: { languageCode: code } });
      if (primaryCount > 0 || secondaryCount > 0) return sendError(res, "Impossible de supprimer une langue associée à des podcasts.");
      
      await prisma.language.delete({ where: { code } });
      return sendSuccess(res, { deleted: true });
    } catch (e: any) {
      return sendError(res, e.message);
    }
  }
}"""

# Replace the last closing brace
content = content[:content.rfind('}')] + delete_language + "\n"

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
