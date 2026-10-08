const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function killLocks() {
  console.log('Killing idle transactions...');
  try {
    const result = await prisma.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'idle in transaction';
    `);
    console.log('Killed idle transactions:', result);
    
    const result2 = await prisma.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'active'
        AND (now() - query_start) > interval '10 seconds';
    `);
    console.log('Killed hanging active queries:', result2);
  } catch (err) {
    console.error('Error killing locks:', err);
  } finally {
    await prisma.$disconnect();
  }
}

killLocks();
