import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { verifySessionToken } from './server_auth.js';
import { isD1Configured } from './server_d1.js';
import { d1GetProfile } from './server_db_d1.js';
import { getBaseUrl, resolveCanonicalUid } from './server_routes_mcp_auth.js';

export const mcpRouter = Router();

export interface McpUserContext {
  uid: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      mcpUser?: McpUserContext;
    }
  }
}

// In-memory profile storage for unit tests / offline dev fallback
export const inMemoryMcpProfiles = new Map<string, any>();

export function setInMemoryMcpProfile(uid: string, data: any): void {
  inMemoryMcpProfiles.set(uid, data);
}

export function clearInMemoryMcpProfiles(): void {
  inMemoryMcpProfiles.clear();
}

/**
 * Authentication Middleware for MCP endpoints.
 * Emits 401 with RFC 9728 resource_metadata challenge if Bearer token is missing/invalid.
 */
mcpRouter.use('/api/mcp', (req: Request, res: Response, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const baseUrl = getBaseUrl(req);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Bearer token required"`
    );
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: 'Unauthorized: Bearer token required'
      }
    });
  }

  const token = authHeader.substring(7).trim();
  const session = verifySessionToken(token);

  if (!session || !session.uid) {
    const baseUrl = getBaseUrl(req);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Invalid or expired token"`
    );
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: 'Unauthorized: Invalid or expired Bearer token'
      }
    });
  }

  const canonicalUid = resolveCanonicalUid(session.uid, session.email);
  req.mcpUser = {
    uid: canonicalUid,
    email: session.email
  };
  next();
});

/**
 * Fetch user profile from D1, in-memory store, or local sync file.
 */
async function loadUserProfile(canonicalUid: string): Promise<any> {
  // 1. Check in-memory store (used for tests or ephemeral state)
  if (inMemoryMcpProfiles.has(canonicalUid)) {
    return inMemoryMcpProfiles.get(canonicalUid);
  }

  // 2. Check Cloudflare D1 database
  if (isD1Configured()) {
    try {
      const profRow = await d1GetProfile(canonicalUid);
      if (profRow?.data) {
        return profRow.data;
      }
    } catch (err: any) {
      console.warn('[MCP] d1GetProfile error:', err?.message);
    }
  }

  // 3. Fallback to local sync file if available
  try {
    const syncFilePath = path.join(process.cwd(), 'data', 'sync', `${canonicalUid}_profile.json`);
    if (fs.existsSync(syncFilePath)) {
      const raw = fs.readFileSync(syncFilePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err: any) {
    console.warn('[MCP] Local sync file read error:', err?.message);
  }

  return {
    profile: {
      id: canonicalUid,
      email: `${canonicalUid}@health-tracker.co.uk`,
      targets: {}
    },
    report: {}
  };
}

/**
 * Available tools definition for Step 1 Spike
 */
const MCP_TOOLS = [
  {
    name: 'manage_home',
    description: 'Manage user profile, homepage targets, goals, and daily summary.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_profile', 'set_targets', 'get_homepage_summary'],
          description: 'The home action to perform'
        },
        payload: {
          type: 'object',
          description: 'Optional payload for the action (e.g. target updates)'
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional unique key to ensure idempotent execution'
        }
      },
      required: ['action']
    }
  }
];

// ---------------------------------------------------------------------------
// MCP Protocol Handler: POST /api/mcp
// ---------------------------------------------------------------------------
mcpRouter.post('/api/mcp', async (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
    });
  }

  const currentUser = req.mcpUser!;

  switch (method) {
    case 'initialize': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: {
            name: 'health-tracker-mcp',
            version: '1.0.0'
          }
        }
      });
    }

    case 'notifications/initialized': {
      // Standard JSON-RPC notification acknowledgment
      return res.status(200).json({ jsonrpc: '2.0', result: {} });
    }

    case 'ping': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {}
      });
    }

    case 'tools/list': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS
        }
      });
    }

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === 'manage_home') {
        const action = args.action;

        if (action === 'get_profile') {
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;
          const report = profileData.report || {};
          const targets = rawProfile.targets || rawProfile.generalNutrientTargets || report.dailyNutrientTargets || {};

          const summary = {
            canonicalUid: currentUser.uid,
            email: currentUser.email,
            profile: {
              nickname: rawProfile.nickname || 'User',
              language: rawProfile.language || 'en',
              userType: rawProfile.userType || 'Standard',
              ...rawProfile
            },
            targets,
            report
          };

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(summary, null, 2)
                }
              ]
            }
          });
        }

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unsupported action "${action}" for tool "manage_home". Available in Step 1: "get_profile".`
              }
            ]
          }
        });
      }

      return res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Tool not found: "${toolName}"`
        }
      });
    }

    default: {
      return res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: "${method}"`
        }
      });
    }
  }
});
