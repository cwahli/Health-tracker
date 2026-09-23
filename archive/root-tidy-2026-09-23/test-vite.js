import { createServer } from 'vite';
async function run() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  console.log("Vite initialized.");
  process.exit(0);
}
run();
