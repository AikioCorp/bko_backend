import sys

file_path = r'c:\Dev\Projet\bamako-Podcast\Bko_backend\src\routes\v1\index.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add import
import_statement = 'import { StudioOfferController } from "../../modules/studio/StudioOfferController.js";\n'
if import_statement not in content:
    content = content.replace('import { ReferentialController }', import_statement + 'import { ReferentialController }')

# Add routes
routes_code = '''
// --- STUDIO OFFERS & PRICING ---
router.get("/studio-offers", StudioOfferController.getActiveOffers); // Public

// Admin routes
router.get("/admin/studio-offers", authenticateToken, StudioOfferController.getAllOffers);
router.post("/admin/studio-offers", authenticateToken, StudioOfferController.createOffer);
router.patch("/admin/studio-offers/:id", authenticateToken, StudioOfferController.updateOffer);
router.delete("/admin/studio-offers/:id", authenticateToken, StudioOfferController.deleteOffer);
'''

if 'router.get("/studio-offers"' not in content:
    content = content.replace('export default router;', routes_code + '\nexport default router;')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
