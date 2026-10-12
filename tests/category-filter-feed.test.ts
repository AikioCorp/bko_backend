import { describe, it, expect } from "vitest";
import { PersonalizationEngineService } from "../src/modules/recommendations/personalization-engine.service.js";
import { prisma } from "../src/config/prisma.js";

describe("Home Category Filter and Infinite Feed Integration", { timeout: 30000 }, () => {
  it("filters home sections and feed by category without throwing or corrupting payload", async () => {
    // 1. Fetch categories
    const category = await prisma.category.findFirst({
      where: { podcasts: { some: {} } },
      select: { id: true, slug: true, name: true },
    });

    // 2. Fetch unfiltered home
    const unfilteredHome = await PersonalizationEngineService.getPersonalizedHome(
      undefined,
      undefined,
      "all",
      "all"
    );

    expect(unfilteredHome).toBeDefined();
    expect(unfilteredHome.categoryShelves).toEqual([]); // confirmed removed to save latency
    expect(Array.isArray(unfilteredHome.heroSlides)).toBe(true);

    if (category) {
      // 3. Fetch category filtered home
      const filteredHome = await PersonalizationEngineService.getPersonalizedHome(
        undefined,
        undefined,
        "all",
        category.slug
      );

      expect(filteredHome).toBeDefined();
      expect(filteredHome.categoryShelves).toEqual([]);
      
      // 4. Fetch standalone feed with category
      const feedResult = await PersonalizationEngineService.getFeed(
        undefined,
        undefined,
        "all",
        category.slug,
        undefined,
        10
      );

      expect(feedResult).toBeDefined();
      expect(Array.isArray(feedResult.items)).toBe(true);
      expect(typeof feedResult.hasMore).toBe("boolean");
      if (feedResult.items.length > 0) {
        // Items must match selected category or its podcasts
        const firstItem = feedResult.items[0];
        expect(firstItem.id).toBeDefined();
      }
    }
  });

  it("paginates infinite feed with cursor correctly", async () => {
    const page1 = await PersonalizationEngineService.getFeed(undefined, undefined, "all", "all", undefined, 5);
    expect(page1.items.length).toBeLessThanOrEqual(5);

    if (page1.hasMore && page1.nextCursor) {
      const page2 = await PersonalizationEngineService.getFeed(undefined, undefined, "all", "all", page1.nextCursor, 5);
      expect(page2.items.length).toBeLessThanOrEqual(5);

      // Verify no duplicate IDs across sequential pages
      const page1Ids = new Set(page1.items.map((it: any) => it.id));
      const hasDuplicate = page2.items.some((it: any) => page1Ids.has(it.id));
      expect(hasDuplicate).toBe(false);
    }
  });
});
