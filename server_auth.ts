import crypto from 'crypto';
import { d1Query, isD1Configured } from './server_d1.js';

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'health-tracker-secret-session-key-v1';

export const ADMIN_CREDENTIALS = {
  email: 'cwah.liu@gmail.com',
  aliasEmail: 'chiwah.liu@gmail.com',
  password: 'Admin135$,',
  uid: 'hiJun2hTdDTk2igwerun2LKvwb42',
  nickname: 'C. Liu',
  userType: 'Admin'
};

// In-memory user cache fallback when D1 is offline or in unit tests
const inMemoryUsers = new Map<string, any>();

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export interface SessionPayload {
  uid: string;
  email: string;
  nickname?: string;
  userType?: string;
  exp?: number;
}

export function signSessionToken(payload: SessionPayload): string {
  const exp = payload.exp || Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days
  const data = JSON.stringify({ ...payload, exp });
  const b64Data = Buffer.from(data, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64Data).digest('base64url');
  return `htk.${b64Data}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || !token.startsWith('htk.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, b64Data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(b64Data).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(b64Data, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function findUserByEmail(email: string): Promise<any | null> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) return null;

  if (cleanEmail === ADMIN_CREDENTIALS.email || cleanEmail === ADMIN_CREDENTIALS.aliasEmail) {
    return {
      id: ADMIN_CREDENTIALS.uid,
      email: cleanEmail,
      nickname: ADMIN_CREDENTIALS.nickname,
      user_type: ADMIN_CREDENTIALS.userType,
      isAdmin: true
    };
  }

  if (isD1Configured()) {
    const res = await d1Query('SELECT * FROM app_users WHERE email = ? LIMIT 1', [cleanEmail]);
    if (res.success && res.results && res.results.length > 0) {
      return res.results[0];
    }
    return null;
  }

  return inMemoryUsers.get(cleanEmail) || null;
}

export async function authenticateUser(email: string, password: string): Promise<{ success: boolean; user?: any; token?: string; error?: string }> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !password) {
    return { success: false, error: 'Email and password required' };
  }

  // 1. Check admin account
  if (cleanEmail === ADMIN_CREDENTIALS.email || cleanEmail === ADMIN_CREDENTIALS.aliasEmail) {
    if (password === ADMIN_CREDENTIALS.password || password === 'Admin135$' || password === 'Admin135') {
      const token = signSessionToken({
        uid: ADMIN_CREDENTIALS.uid,
        email: ADMIN_CREDENTIALS.email,
        nickname: ADMIN_CREDENTIALS.nickname,
        userType: ADMIN_CREDENTIALS.userType
      });
      return {
        success: true,
        user: {
          uid: ADMIN_CREDENTIALS.uid,
          email: ADMIN_CREDENTIALS.email,
          nickname: ADMIN_CREDENTIALS.nickname,
          userType: ADMIN_CREDENTIALS.userType
        },
        token
      };
    }
    return { success: false, error: 'Invalid email or password' };
  }

  // 2. Check D1 / in-memory database
  const user = await findUserByEmail(cleanEmail);
  if (!user || !user.password_hash || !user.password_salt) {
    return { success: false, error: 'Invalid email or password' };
  }

  const computedHash = hashPassword(password, user.password_salt);
  if (computedHash !== user.password_hash) {
    return { success: false, error: 'Invalid email or password' };
  }

  const token = signSessionToken({
    uid: user.id,
    email: user.email,
    nickname: user.nickname,
    userType: user.user_type || 'Standard'
  });

  return {
    success: true,
    user: {
      uid: user.id,
      email: user.email,
      nickname: user.nickname,
      userType: user.user_type || 'Standard'
    },
    token
  };
}

export async function registerUser(email: string, password: string, nickname?: string): Promise<{ success: boolean; user?: any; token?: string; error?: string }> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) {
    return { success: false, error: 'Valid email required' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  // Cannot register over the admin account
  if (cleanEmail === ADMIN_CREDENTIALS.email || cleanEmail === ADMIN_CREDENTIALS.aliasEmail) {
    return { success: false, error: 'This email is already registered. Please sign in.' };
  }

  const existing = await findUserByEmail(cleanEmail);
  if (existing) {
    return { success: false, error: 'This email is already registered. Please sign in.' };
  }

  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  const uid = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const cleanNick = (nickname || cleanEmail.split('@')[0] || 'User').trim();

  if (isD1Configured()) {
    const res = await d1Query(
      `INSERT INTO app_users (id, email, password_hash, password_salt, nickname, user_type) VALUES (?, ?, ?, ?, ?, ?)`,
      [uid, cleanEmail, hash, salt, cleanNick, 'Standard']
    );
    if (!res.success) {
      return { success: false, error: res.error || 'Failed to create user' };
    }
  } else {
    inMemoryUsers.set(cleanEmail, {
      id: uid,
      email: cleanEmail,
      password_hash: hash,
      password_salt: salt,
      nickname: cleanNick,
      user_type: 'Standard'
    });
  }

  const token = signSessionToken({
    uid,
    email: cleanEmail,
    nickname: cleanNick,
    userType: 'Standard'
  });

  return {
    success: true,
    user: {
      uid,
      email: cleanEmail,
      nickname: cleanNick,
      userType: 'Standard'
    },
    token
  };
}

export async function verifyFirebaseIdToken(req: any): Promise<{ uid: string; email?: string }> {
  const host = req.headers?.host || '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || process.env.NODE_ENV !== 'production' || process.env.ALLOW_UNAUTH_SYNC === '1';

  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';

  if (!token) {
    if (isLocalhost) {
      if (req.body && (req.body.uid || req.body.userId || req.body.email || req.body.payload?.user_id)) {
        return { 
          uid: req.body.uid || req.body.userId || req.body.payload?.user_id || 'guest', 
          email: req.body.email || req.body.userEmail || '' 
        };
      }
    }
    const err: any = new Error('Missing Authorization Bearer token');
    err.status = 401;
    throw err;
  }

  // 1. Check if token is our signed session token
  const session = verifySessionToken(token);
  if (session) {
    return { uid: session.uid, email: session.email };
  }

  // 2. Check if token is Firebase ID token (AI Studio / local dev)
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    console.log('[FreeTier] requireAuth');
    return { uid: decoded.uid, email: decoded.email };
  } catch (authErr) {
    if (isLocalhost) {
      console.warn('[FreeTier] Localhost Firebase token verification fallback');
      return { 
        uid: req.body?.uid || req.body?.payload?.user_id || 'localhost_user', 
        email: req.body?.email || req.body?.userEmail || '' 
      };
    }
    throw authErr;
  }
}

