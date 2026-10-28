import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { verifySessionToken } from './server_auth.js';
import { isD1Configured } from './server_d1.js';
import {
  d1GetProfile,
  d1UpsertProfile,
  d1QueryFoods,
  d1GetFullFoodRecord,
  d1QueryBiomarkers
} from './server_db_d1.js';
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

// ---------------------------------------------------------------------------
// Multi-Tenant UID & In-Memory Stores (for testing / offline fallback)
// ---------------------------------------------------------------------------

export const inMemoryMcpProfiles = new Map<string, any>();
export const inMemoryMcpFoods = new Map<string, any[]>();
export const inMemoryMcpBiomarkers = new Map<string, any[]>();

export function setInMemoryMcpProfile(uid: string, data: any): void {
  inMemoryMcpProfiles.set(uid, data);
}

export function clearInMemoryMcpProfiles(): void {
  inMemoryMcpProfiles.clear();
}

export function setInMemoryMcpFoods(uid: string, foods: any[]): void {
  inMemoryMcpFoods.set(uid, foods);
}

export function setInMemoryMcpBiomarkers(uid: string, biomarkers: any[]): void {
  inMemoryMcpBiomarkers.set(uid, biomarkers);
}

export function clearInMemoryMcpData(): void {
  inMemoryMcpProfiles.clear();
  inMemoryMcpFoods.clear();
  inMemoryMcpBiomarkers.clear();
}

export function resolvePossibleUids(uid?: string, email?: string): string[] {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUid = (uid || '').trim();
  const normalizedEmailUid = cleanEmail ? 'admin_' + cleanEmail.replace(/[^a-z0-9]/gi, '_') : null;
  const isCwah = cleanEmail.includes('cwah.liu') || cleanEmail.includes('chiwah.liu') ||
                 cleanUid.includes('cwah_liu') || cleanUid.includes('chiwah_liu') ||
                 cleanUid === 'hiJun2hTdDTk2igwerun2LKvwb42';
  return Array.from(new Set([
    cleanUid,
    cleanEmail,
    normalizedEmailUid,
    isCwah ? 'hiJun2hTdDTk2igwerun2LKvwb42' : null,
    isCwah ? 'cwah.liu@gmail.com' : null,
    isCwah ? 'chiwah.liu@gmail.com' : null,
    isCwah ? 'admin_cwah_liu_gmail_com' : null,
    isCwah ? 'admin_chiwah_liu_gmail_com' : null
  ].filter(Boolean) as string[]));
}

export function toYYYYMMDD(val: any): string {
  if (!val) return new Date().toISOString().split('T')[0];
  const str = String(val).trim();
  if (!str) return new Date().toISOString().split('T')[0];
  
  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  const dMmmYMatch = str.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})/);
  if (dMmmYMatch) {
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const mm = monthMap[dMmmYMatch[2].toLowerCase()] || '01';
    return `${dMmmYMatch[3]}-${mm}-${dMmmYMatch[1].padStart(2, '0')}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch {}

  return str;
}

export function getYesterdayYYYYMMDD(referenceDate?: string): string {
  const ref = referenceDate ? toYYYYMMDD(referenceDate) : new Date().toISOString().split('T')[0];
  const parts = ref.split('-');
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

export function formatPhotoUrls(imageUrls: any): string[] {
  if (!imageUrls) return [];
  const list = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  return list.map((u: any) => {
    if (!u || typeof u !== 'string') return '';
    const trimmed = u.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('/photos/')) return `https://health-tracker.co.uk${trimmed}`;
    if (trimmed.startsWith('photos/')) return `https://health-tracker.co.uk/${trimmed}`;
    return `https://health-tracker.co.uk/photos/${trimmed}`;
  }).filter(Boolean);
}

export function parseNumericTarget(val: any, fallback: number): number {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  const str = String(val).replace(/,/g, '').trim();
  const match = str.match(/[-+]?\d*\.?\d+/);
  if (!match) return fallback;
  const parsed = parseFloat(match[0]);
  return isNaN(parsed) ? fallback : parsed;
}

// ---------------------------------------------------------------------------
// Authentication Middleware (RFC 9728 Challenge)
// ---------------------------------------------------------------------------

const MCP_PATHS = ['/api/mcp', '/mcp'];

mcpRouter.use(MCP_PATHS, (req: Request, res: Response, next) => {
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

// ---------------------------------------------------------------------------
// Data Fetchers & Aggregators
// ---------------------------------------------------------------------------

async function loadUserProfile(canonicalUid: string): Promise<any> {
  if (inMemoryMcpProfiles.has(canonicalUid)) {
    return inMemoryMcpProfiles.get(canonicalUid);
  }

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
      targets: {
        calories: 1651
      }
    },
    report: {
      dailyNutrientTargets: {
        calories: "1,651 kcal"
      }
    }
  };
}

async function getAllUserFoods(possibleUids: string[]): Promise<any[]> {
  const foodsMap = new Map<string, any>();

  // 1. In-memory items
  for (const uid of possibleUids) {
    const memList = inMemoryMcpFoods.get(uid);
    if (Array.isArray(memList)) {
      for (const item of memList) {
        if (item && item.id) foodsMap.set(item.id, item);
      }
    }
  }

  // 2. D1 database items
  if (isD1Configured()) {
    try {
      const d1Foods = await d1QueryFoods(possibleUids, 500);
      for (const item of d1Foods) {
        if (item && item.id && !foodsMap.has(item.id)) {
          foodsMap.set(item.id, item);
        }
      }
    } catch (err: any) {
      console.warn('[MCP] d1QueryFoods error:', err?.message);
    }
  }

  return Array.from(foodsMap.values());
}

async function getAllUserBiomarkers(possibleUids: string[]): Promise<any[]> {
  const bioMap = new Map<string, any>();

  // 1. In-memory items
  for (const uid of possibleUids) {
    const memList = inMemoryMcpBiomarkers.get(uid);
    if (Array.isArray(memList)) {
      for (const item of memList) {
        if (item && item.id) bioMap.set(item.id, item);
      }
    }
  }

  // 2. D1 database items
  if (isD1Configured()) {
    try {
      const d1Bios = await d1QueryBiomarkers(possibleUids, 200);
      for (const item of d1Bios) {
        if (item && item.id && !bioMap.has(item.id)) {
          bioMap.set(item.id, item);
        }
      }
    } catch (err: any) {
      console.warn('[MCP] d1QueryBiomarkers error:', err?.message);
    }
  }

  return Array.from(bioMap.values());
}

function computeDayAllowance(targetDate: string, allMeals: any[], targets: any) {
  const dayMeals = allMeals.filter((m) => toYYYYMMDD(m.date) === targetDate);

  const targetCalories = parseNumericTarget(
    targets.calories ?? targets.calorieTarget ?? targets.dailyNutrientTargets?.calories,
    1651
  );
  const targetSatFat = parseNumericTarget(targets.saturatedFat ?? targets.satFat, 15);
  const targetFiber = parseNumericTarget(targets.totalFibre ?? targets.fiber ?? targets.fibre, 30);
  const targetSodium = parseNumericTarget(targets.sodium, 1500);
  const targetProtein = parseNumericTarget(targets.protein, 70);
  const targetCarbs = parseNumericTarget(targets.carbohydrates ?? targets.carbs, 200);
  const targetFat = parseNumericTarget(targets.totalFat ?? targets.fat, 60);

  let consumedCalories = 0;
  let consumedSatFat = 0;
  let consumedFiber = 0;
  let consumedSodium = 0;
  let consumedProtein = 0;
  let consumedCarbs = 0;
  let consumedFat = 0;

  const mealsSummary: any[] = [];

  for (const m of dayMeals) {
    const kcal = Number(m.calories) || Number(m.nutrients?.calories) || 0;
    const sat = Number(m.saturated_fat) || Number(m.nutrients?.saturatedFat) || 0;
    const fib = Number(m.nutrients?.totalFibre) || Number(m.nutrients?.fiber) || 0;
    const sod = Number(m.sodium) || Number(m.nutrients?.sodium) || 0;
    const pro = Number(m.nutrients?.protein) || 0;
    const car = Number(m.nutrients?.carbohydrates) || 0;
    const fat = Number(m.nutrients?.totalFat) || 0;

    consumedCalories += kcal;
    consumedSatFat += sat;
    consumedFiber += fib;
    consumedSodium += sod;
    consumedProtein += pro;
    consumedCarbs += car;
    consumedFat += fat;

    mealsSummary.push({
      id: m.id,
      name: m.name || 'Logged Meal',
      time: m.date,
      calories: Math.round(kcal),
      protein_g: Math.round(pro * 10) / 10,
      carbs_g: Math.round(car * 10) / 10,
      fat_g: Math.round(fat * 10) / 10,
      saturated_fat_g: Math.round(sat * 10) / 10,
      fiber_g: Math.round(fib * 10) / 10,
      sodium_mg: Math.round(sod),
      photos: formatPhotoUrls(m.image_urls)
    });
  }

  consumedCalories = Math.round(consumedCalories);
  const remainingCalories = targetCalories - consumedCalories;
  const percentageReached = targetCalories > 0 ? Math.round((consumedCalories / targetCalories) * 100) : 0;
  const status = consumedCalories > targetCalories ? 'exceeded_allowance' : 'within_allowance';

  return {
    date: targetDate,
    target_allowance_kcal: targetCalories,
    consumed_kcal: consumedCalories,
    remaining_kcal: remainingCalories,
    percentage_reached: percentageReached,
    status,
    meal_count: dayMeals.length,
    nutrients: {
      calories: { target: targetCalories, consumed: consumedCalories, remaining: remainingCalories, unit: 'kcal' },
      saturated_fat: { target: targetSatFat, consumed: Math.round(consumedSatFat * 10) / 10, unit: 'g', ceiling_exceeded: consumedSatFat > targetSatFat },
      fiber: { target: targetFiber, consumed: Math.round(consumedFiber * 10) / 10, unit: 'g', goal_met: consumedFiber >= targetFiber },
      sodium: { target: targetSodium, consumed: Math.round(consumedSodium), unit: 'mg', ceiling_exceeded: consumedSodium > targetSodium },
      protein: { target: targetProtein, consumed: Math.round(consumedProtein * 10) / 10, unit: 'g' },
      carbohydrates: { target: targetCarbs, consumed: Math.round(consumedCarbs * 10) / 10, unit: 'g' },
      total_fat: { target: targetFat, consumed: Math.round(consumedFat * 10) / 10, unit: 'g' }
    },
    meals: mealsSummary
  };
}

// ---------------------------------------------------------------------------
// Tool Catalog (MCP Schema)
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: 'manage_home',
    description: 'Manage user profile, homepage targets, goals, daily allowance progress, and dashboard summary.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_profile', 'get_allowance_progress', 'get_dashboard', 'set_targets'],
          description: 'The home action to perform. Use get_allowance_progress to see consumed vs target kcal and macros for today and yesterday.'
        },
        date: {
          type: 'string',
          description: 'Optional date (YYYY-MM-DD) for allowance progress (defaults to today and yesterday summary)'
        },
        targets: {
          type: 'object',
          description: 'Nutrient target updates for set_targets (e.g. { calories: 1651, saturatedFat: "15 g", totalFibre: "30 g" })'
        },
        payload: {
          type: 'object',
          description: 'Optional payload for the action (alias for targets)'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'manage_meals',
    description: 'Browse, query, and inspect logged meals and food records across dates, keywords, and nutritional details.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get_detail'],
          description: 'Action to perform: "list" to search and browse meals; "get_detail" to view a specific meal by ID.'
        },
        date: {
          type: 'string',
          description: 'Filter meals for a single date (YYYY-MM-DD)'
        },
        date_from: {
          type: 'string',
          description: 'Start of date range (YYYY-MM-DD)'
        },
        date_to: {
          type: 'string',
          description: 'End of date range (YYYY-MM-DD)'
        },
        search: {
          type: 'string',
          description: 'Search keyword matching meal name, composition, or dishes'
        },
        meal_id: {
          type: 'string',
          description: 'Meal ID to fetch detail for (required for get_detail)'
        },
        mealId: {
          type: 'string',
          description: 'Alias for meal_id'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of meals to return (default 50)'
        },
        offset: {
          type: 'number',
          description: 'Pagination offset'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'manage_biomarkers',
    description: 'Browse and analyze biomarker records, blood tests, vitals history, and longitudinal trends.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get_trends'],
          description: 'Action: "list" to browse historical biomarker records, "get_trends" to compute min/max/delta trends.'
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Biomarker keys to filter or trend (e.g. ["cholesterol", "hba1c", "vitaminD", "bloodPressure"])'
        },
        key: {
          type: 'string',
          description: 'Single biomarker key (alias for keys)'
        },
        date_from: {
          type: 'string',
          description: 'Start of date range (YYYY-MM-DD)'
        },
        date_to: {
          type: 'string',
          description: 'End of date range (YYYY-MM-DD)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default 50)'
        }
      },
      required: ['action']
    }
  }
];

// ---------------------------------------------------------------------------
// Protocol Endpoints: GET & POST /api/mcp and /mcp
// ---------------------------------------------------------------------------

mcpRouter.get(MCP_PATHS, (req: Request, res: Response) => {
  if (req.headers.accept?.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    res.write(`event: endpoint\ndata: ${getBaseUrl(req)}/api/mcp\n\n`);
    return;
  }
  return res.json({
    name: 'health-tracker-mcp',
    version: '1.1.0',
    protocolVersion: '2024-11-05',
    transport: 'streamable-http',
    status: 'ready'
  });
});

mcpRouter.post(MCP_PATHS, async (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
    });
  }

  const currentUser = req.mcpUser!;
  const possibleUids = resolvePossibleUids(currentUser.uid, currentUser.email);

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
            version: '1.1.0'
          }
        }
      });
    }

    case 'notifications/initialized': {
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

      // ---------------------------------------------------------------------
      // 1. MANAGE_HOME
      // ---------------------------------------------------------------------
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
            possibleUids,
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
              content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
            }
          });
        }

        if (action === 'get_allowance_progress' || action === 'get_dashboard') {
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;
          const report = profileData.report || {};
          const targets = rawProfile.targets || rawProfile.generalNutrientTargets || report.dailyNutrientTargets || {};

          const allMeals = await getAllUserFoods(possibleUids);

          const requestedDate = args.date ? toYYYYMMDD(args.date) : null;
          const todayDate = toYYYYMMDD(new Date());
          const yesterdayDate = getYesterdayYYYYMMDD(todayDate);

          if (requestedDate && requestedDate !== todayDate && requestedDate !== yesterdayDate) {
            const requestedProgress = computeDayAllowance(requestedDate, allMeals, targets);
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(requestedProgress, null, 2) }]
              }
            });
          }

          const todayProgress = computeDayAllowance(todayDate, allMeals, targets);
          const yesterdayProgress = computeDayAllowance(yesterdayDate, allMeals, targets);

          const result: any = {
            baseline_daily_allowance_kcal: parseNumericTarget(
              targets.calories ?? report.dailyNutrientTargets?.calories,
              1651
            ),
            today: todayProgress,
            yesterday: yesterdayProgress
          };

          if (action === 'get_dashboard') {
            result.profile = {
              nickname: rawProfile.nickname || 'User',
              language: rawProfile.language || 'en'
            };
            result.targets = targets;
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            }
          });
        }

        if (action === 'set_targets') {
          const newTargets = args.targets || args.payload || {};
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;
          const report = profileData.report || {};

          rawProfile.targets = {
            ...(rawProfile.targets || {}),
            ...newTargets
          };
          if (!report.dailyNutrientTargets) report.dailyNutrientTargets = {};
          Object.assign(report.dailyNutrientTargets, newTargets);

          const updatedData = {
            ...profileData,
            profile: rawProfile,
            report,
            updated_at: new Date().toISOString()
          };

          inMemoryMcpProfiles.set(currentUser.uid, updatedData);

          if (isD1Configured()) {
            await d1UpsertProfile(currentUser.uid, updatedData);
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: 'Nutrient targets updated successfully',
                      updated_targets: rawProfile.targets
                    },
                    null,
                    2
                  )
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
                text: `Unsupported action "${action}" for tool "manage_home". Available: "get_profile", "get_allowance_progress", "get_dashboard", "set_targets".`
              }
            ]
          }
        });
      }

      // ---------------------------------------------------------------------
      // 2. MANAGE_MEALS
      // ---------------------------------------------------------------------
      if (toolName === 'manage_meals') {
        const action = args.action;

        if (action === 'list') {
          const allMeals = await getAllUserFoods(possibleUids);

          const filterDate = args.date ? toYYYYMMDD(args.date) : null;
          const dateFrom = args.date_from ? toYYYYMMDD(args.date_from) : null;
          const dateTo = args.date_to ? toYYYYMMDD(args.date_to) : null;
          const search = args.search ? String(args.search).toLowerCase().trim() : null;

          let filtered = allMeals.filter((m) => {
            const mDate = toYYYYMMDD(m.date);
            if (filterDate && mDate !== filterDate) return false;
            if (dateFrom && mDate < dateFrom) return false;
            if (dateTo && mDate > dateTo) return false;
            if (search) {
              const nameMatch = (m.name || '').toLowerCase().includes(search);
              const compMatch = (m.composition || '').toLowerCase().includes(search);
              const descMatch = (m.description || '').toLowerCase().includes(search);
              const itemsMatch = Array.isArray(m.items_breakdown) &&
                m.items_breakdown.some((it: any) => (it.name || '').toLowerCase().includes(search));
              if (!nameMatch && !compMatch && !descMatch && !itemsMatch) return false;
            }
            return true;
          });

          filtered.sort((a, b) => {
            const da = toYYYYMMDD(a.date);
            const db = toYYYYMMDD(b.date);
            if (da !== db) return db.localeCompare(da);
            return String(b.updated_at || b.id).localeCompare(String(a.updated_at || a.id));
          });

          const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
          const offset = typeof args.offset === 'number' && args.offset > 0 ? args.offset : 0;
          const paged = filtered.slice(offset, offset + limit);

          const formattedMeals = paged.map((m) => ({
            id: m.id,
            date: m.date,
            date_formatted: toYYYYMMDD(m.date),
            name: m.name || 'Logged Meal',
            composition: m.composition || '',
            weight_grams: m.weight_grams || 0,
            calories: Number(m.calories) || Number(m.nutrients?.calories) || 0,
            saturated_fat_g: Number(m.saturated_fat) || Number(m.nutrients?.saturatedFat) || 0,
            sodium_mg: Number(m.sodium) || Number(m.nutrients?.sodium) || 0,
            added_sugar_g: Number(m.added_sugar) || Number(m.nutrients?.addedSugar) || 0,
            nutrients: m.nutrients || {},
            items_breakdown: m.items_breakdown || [],
            image_urls: formatPhotoUrls(m.image_urls),
            benefits: m.benefits || '',
            risks: m.risks || '',
            recommendation: m.recommendation || '',
            updated_at: m.updated_at
          }));

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      total: filtered.length,
                      limit,
                      offset,
                      meals: formattedMeals
                    },
                    null,
                    2
                  )
                }
              ]
            }
          });
        }

        if (action === 'get_detail') {
          const mealId = args.meal_id || args.mealId || args.id;
          if (!mealId) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Missing required argument "meal_id"' }]
              }
            });
          }

          let foundMeal: any = null;

          // Check in-memory stores
          for (const uid of possibleUids) {
            const memList = inMemoryMcpFoods.get(uid);
            if (Array.isArray(memList)) {
              foundMeal = memList.find((m) => m && m.id === mealId);
              if (foundMeal) break;
            }
          }

          // Check D1 database
          if (!foundMeal && isD1Configured()) {
            try {
              foundMeal = await d1GetFullFoodRecord(mealId, possibleUids);
            } catch (err: any) {
              console.warn('[MCP] d1GetFullFoodRecord error:', err?.message);
            }
          }

          if (!foundMeal) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: `Meal not found with ID "${mealId}"` }]
              }
            });
          }

          const detail = {
            ...foundMeal,
            date_formatted: toYYYYMMDD(foundMeal.date),
            calories: Number(foundMeal.calories) || Number(foundMeal.nutrients?.calories) || 0,
            image_urls: formatPhotoUrls(foundMeal.image_urls)
          };

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }]
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
                text: `Unsupported action "${action}" for tool "manage_meals". Available: "list", "get_detail".`
              }
            ]
          }
        });
      }

      // ---------------------------------------------------------------------
      // 3. MANAGE_BIOMARKERS
      // ---------------------------------------------------------------------
      if (toolName === 'manage_biomarkers') {
        const action = args.action;
        const allBios = await getAllUserBiomarkers(possibleUids);

        if (action === 'list') {
          const dateFrom = args.date_from ? toYYYYMMDD(args.date_from) : null;
          const dateTo = args.date_to ? toYYYYMMDD(args.date_to) : null;
          const requestedKeys: string[] = Array.isArray(args.keys)
            ? args.keys
            : args.key ? [args.key] : [];

          let filtered = allBios.filter((b) => {
            const bDate = toYYYYMMDD(b.date);
            if (dateFrom && bDate < dateFrom) return false;
            if (dateTo && bDate > dateTo) return false;
            return true;
          });

          filtered.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

          const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
          const paged = filtered.slice(0, limit);

          const formatted = paged.map((b) => {
            let biomarkersMap = b.biomarkers || {};
            if (requestedKeys.length > 0) {
              const sub: Record<string, any> = {};
              for (const k of requestedKeys) {
                if (k in biomarkersMap) sub[k] = biomarkersMap[k];
              }
              biomarkersMap = sub;
            }
            return {
              id: b.id,
              date: b.date,
              date_formatted: toYYYYMMDD(b.date),
              biomarkers: biomarkersMap,
              note: b.note || '',
              summary: b.summary || '',
              tests: b.tests || [],
              updated_at: b.updated_at
            };
          });

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      total: filtered.length,
                      count: formatted.length,
                      biomarker_logs: formatted
                    },
                    null,
                    2
                  )
                }
              ]
            }
          });
        }

        if (action === 'get_trends') {
          const requestedKeys: string[] = Array.isArray(args.keys) && args.keys.length > 0
            ? args.keys
            : args.key ? [args.key] : [];

          // Collect all readings per biomarker key
          const keyReadings = new Map<string, Array<{ date: string; value: number; raw: any; unit: string }>>();

          for (const b of allBios) {
            const dateStr = toYYYYMMDD(b.date);
            const bios = b.biomarkers || {};
            for (const [k, val] of Object.entries(bios)) {
              if (requestedKeys.length > 0 && !requestedKeys.includes(k)) continue;
              const numVal = parseNumericTarget(val, NaN);
              if (isNaN(numVal)) continue;

              const rawStr = String(val);
              const unitMatch = rawStr.match(/(mmol\/L|mg\/dL|g\/dL|mcg\/L|ug\/L|IU\/mL|ng\/mL|%|bpm|mmHg)/i);
              const unit = unitMatch ? unitMatch[0] : '';

              if (!keyReadings.has(k)) keyReadings.set(k, []);
              keyReadings.get(k)!.push({
                date: dateStr,
                value: numVal,
                raw: val,
                unit
              });
            }
          }

          const trends: Record<string, any> = {};

          for (const [k, readings] of keyReadings.entries()) {
            readings.sort((a, b) => a.date.localeCompare(b.date));
            if (readings.length === 0) continue;

            const latest = readings[readings.length - 1];
            const previous = readings.length >= 2 ? readings[readings.length - 2] : null;

            let minReading = readings[0];
            let maxReading = readings[0];
            for (const r of readings) {
              if (r.value < minReading.value) minReading = r;
              if (r.value > maxReading.value) maxReading = r;
            }

            const delta = previous ? Math.round((latest.value - previous.value) * 100) / 100 : 0;
            const deltaPct = previous && previous.value !== 0
              ? Math.round(((latest.value - previous.value) / previous.value) * 100)
              : 0;

            const trendDirection = delta > 0.05 ? 'increasing' : delta < -0.05 ? 'decreasing' : 'stable';

            trends[k] = {
              biomarker_key: k,
              readings_count: readings.length,
              latest: { date: latest.date, value: latest.value, unit: latest.unit },
              previous: previous ? { date: previous.date, value: previous.value, unit: previous.unit } : null,
              min: { date: minReading.date, value: minReading.value, unit: minReading.unit },
              max: { date: maxReading.date, value: maxReading.value, unit: maxReading.unit },
              delta,
              delta_percentage: deltaPct,
              trend: trendDirection,
              history: readings.map((r) => ({ date: r.date, value: r.value, unit: r.unit }))
            };
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ trends }, null, 2) }]
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
                text: `Unsupported action "${action}" for tool "manage_biomarkers". Available: "list", "get_trends".`
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
