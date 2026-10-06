import { PermissionService } from './src/services/permission.service.js';

async function main() {
    await PermissionService.bootstrap();
    console.log("Bootstrap done");
}

main().catch(console.error).finally(() => process.exit(0));
