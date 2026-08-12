const { spawn } = require('child_process');
const electron = require('electron');

async function main() {
    const { createServer } = await import('vite');
    const server = await createServer({ server: { host: '127.0.0.1', port: 5173 } });
    await server.listen();
    const url = server.resolvedUrls.local[0];
    console.log(`Vite ready at ${url}`);

    const app = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
    const close = async () => {
        if (!app.killed) app.kill();
        await server.close();
    };
    app.on('exit', async code => { await close(); process.exitCode = code || 0; });
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
