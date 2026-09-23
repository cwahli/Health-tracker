const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
const patch = `
import * as http from 'http';
const originalListen = http.Server.prototype.listen;
(http.Server.prototype as any).listen = function(...args: any[]) {
  console.log("[DEBUG] http.Server.prototype.listen called with:", args);
  return originalListen.apply(this, args);
};
`;
code = patch + code;
fs.writeFileSync('server.ts', code);
