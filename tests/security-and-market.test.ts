import assert from "assert";
import { SsrfProtectionService } from "../src/services/ssrf-protection.service.js";
import { MarketService } from "../src/modules/markets/market.service.js";
import { requireAdmin } from "../src/middlewares/auth.middleware.js";

async function runSecurityAndMarketTests() {
  console.log("=================================================");
  console.log("🧪 DÉMARRAGE DU SOCLE DE TESTS DE SÉCURITÉ & MARCHÉ");
  console.log("=================================================\n");

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => Promise<void> | void) {
    total++;
    return Promise.resolve()
      .then(() => fn())
      .then(() => {
        console.log(`  ✅ PASSED: ${name}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  ❌ FAILED: ${name}`);
        console.error(`     Error: ${err.message}`);
      });
  }

  // TEST 1: BLOQUER SSRF IP PRIVÉE & METADATA LINK-LOCAL
  await test("SSRF: Bloquer IP privée (10.0.0.1)", async () => {
    try {
      await SsrfProtectionService.validateUrl("http://10.0.0.1/admin");
      assert.fail("Aurait dû bloquer IP privée");
    } catch (e: any) {
      assert.strictEqual(e.message, "RSS_SSRF_BLOCKED");
    }
  });

  await test("SSRF: Bloquer Metadata AWS / Cloud (169.254.169.254)", async () => {
    try {
      await SsrfProtectionService.validateUrl("http://169.254.169.254/latest/meta-data/");
      assert.fail("Aurait dû bloquer Cloud Metadata");
    } catch (e: any) {
      assert.strictEqual(e.message, "RSS_SSRF_BLOCKED");
    }
  });

  await test("SSRF: Bloquer Loopback IPv4 (127.0.0.1) & Localhost", async () => {
    try {
      await SsrfProtectionService.validateUrl("http://localhost:8080/health");
      assert.fail("Aurait dû bloquer localhost");
    } catch (e: any) {
      assert.strictEqual(e.message, "RSS_SSRF_BLOCKED");
    }
  });

  // TEST 2: MIDDLEWARE REQUIRE ADMIN
  await test("Auth Middleware: Interdire l'accès admin aux auditeurs ordinaires", () => {
    const req: any = { user: { id: "u1", email: "user@test.com", roles: ["USER"] } };
    let statusSent = 0;
    let jsonSent: any = null;
    const res: any = {
      status: (s: number) => {
        statusSent = s;
        return res;
      },
      json: (j: any) => {
        jsonSent = j;
        return res;
      },
    };
    let nextCalled = false;

    requireAdmin(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false, "Next ne doit pas être appelé pour un simple USER");
    assert.strictEqual(statusSent, 403, "Devrait retourner le code HTTP 403");
  });

  await test("Auth Middleware: Autoriser l'accès aux administrateurs", () => {
    const req: any = { user: { id: "admin1", email: "admin@bamakopodcast.studio", roles: ["ADMIN"] } };
    let nextCalled = false;
    const res: any = {};

    requireAdmin(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true, "Next doit être appelé pour un rôle ADMIN");
  });

  console.log("\n=================================================");
  console.log(`🎉 BILAN DU SOCLE DE TESTS: ${passed} / ${total} TESTS RÉUSSIS`);
  console.log("=================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runSecurityAndMarketTests();
