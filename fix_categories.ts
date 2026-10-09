import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const mapping = [
  // Religion
  { ids: ["cmv0w5tgx0005a7zz9yuq6jrv", "cmv0w27xj002aookce3ancm9u", "cmv0zcz15000e11xbm6vq98cv", "cmv0zcy5q000811xblrbl1c6b", "cmv0zd0td000q11xbe7a1k5se", "cmv0zczq7000k11xblchhnbc0"], cat: "cmv0x6o1w002tookcilewkjhc" },
  // Voix de femmes
  { ids: ["cmv0zcwrv000211xbyis7x76i", "cmv0z9v550002rsbssjzh6mdo"], cat: "cmv0xd1g70009uy9yzmzjn9im" },
  // Business
  { ids: ["cmv19xej70002y84ux425wawt", "cmv19xfn80008y84u0jdsz74w", "cmv19xgxi000ky84ul45gsg27", "cmv19xgad000ey84um4hgdobj", "cmv1b2n4s000q14kv70dy7i8d", "cmv1b2o30000w14kv87hadwtz"], cat: "cmura52qi000ev53o5ri1rhod" },
  // Tech
  { ids: ["cmv1b2jmn000214kvv71fydut", "cmv1b2l61000814kvwcv86em2"], cat: "cmura5306000gv53obg6sjvfa" },
  // History
  { ids: ["cmv1afr2q0002mepua76i4z7n", "cmv1b2mfi000k14kvhlc3olm3"], cat: "cmv0xczos0001uy9ys6ippu5v" },
  // Sport
  { ids: ["cmv1aft0t000emepuvjhl1efh"], cat: "cmura533e000hv53obxufstwa" },
  // Culture / Arts
  { ids: ["cmv1afscm0008mepurl2onos3"], cat: "cmura52wy000fv53oz63vn9go" },
  { ids: ["cmv1brt7n000q7gqysvz5d68l"], cat: "cmv0xd18d0008uy9y88xluc5d" },
  // Comédie
  { ids: ["cmv0xoe1v00u4ouwbg8d4euo8", "cmv1brp0f000e7gqywrae3kcl"], cat: "cmv0xd04m0003uy9yelezqzbl" },
  // Contes
  { ids: ["cmv1b2lsu000e14kv56xsy5f9"], cat: "cmv0xczwp0002uy9y59vfb3ks" },
  // News
  { ids: ["cmv1brrjp000k7gqy43u5two9"], cat: "cmura539t000jv53ogrg4cejt" },
  // Santé
  { ids: ["cmv1brnsj00087gqywwvb3s30"], cat: "cmv0xczcv0000uy9yulfpoaot" },
  // Musique
  { ids: ["cmv1brmee00027gqyk6zmc1kp"], cat: "cmura536l000iv53oa54bxqlj" }
];

async function main() {
  for (const m of mapping) {
    for (const pid of m.ids) {
      await prisma.podcastCategory.create({
        data: {
          podcastId: pid,
          categoryId: m.cat
        }
      }).catch(e => { /* Ignore duplicates */ });
      console.log(`Updated ${pid} to category ${m.cat}`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
