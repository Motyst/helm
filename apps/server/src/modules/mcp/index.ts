import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { HelmModule } from '../module.ts';
import { buildMcpServer } from './tools.ts';

/** JSON-RPC error body for requests rejected before they reach the MCP server. */
function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="helm"' },
  });
}

/**
 * MCP over Streamable HTTP at /mcp, stateless: each request gets a fresh server bound to the
 * caller's token. Bearer tokens only (no cookies), so a web page can't drive it with the
 * owner's browser session.
 */
export const mcpModule: HelmModule = {
  name: 'mcp',
  register({ root, services, config }) {
    root.all('/mcp', async (c) => {
      const header = c.req.header('authorization') ?? '';
      const secret = /^bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
      if (!secret) return unauthorized('Send an API token as "Authorization: Bearer <token>". Create one in Helm settings.');
      const principal = services.tokens.resolve(secret);
      if (!principal) return unauthorized('Invalid, expired or revoked token');

      const server = buildMcpServer(services, principal, config);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        return await transport.handleRequest(c.req.raw);
      } finally {
        await server.close();
      }
    });
  },
};
