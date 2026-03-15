// ============================================================
// Entry point del MCP Server para TBS Tango 2
// Inicia el servidor usando transporte stdio
// ============================================================

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🎮 Tango 2 MCP Server iniciado (stdio transport)');
}

main().catch((error) => {
  console.error('Error fatal al iniciar el server:', error);
  process.exit(1);
});
