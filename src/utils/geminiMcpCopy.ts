/**
 * Profile-dialog copy for the Gemini MCP card.
 *
 * These four packs are not in src/utils/translations yet. Open PR #781 already
 * owns en.ts, id.ts, fr.ts, and zh.ts, so this step keeps key parity here
 * until that PR lands and the strings can move into the main dictionaries.
 */
export interface GeminiMcpCopy {
  title: string;
  description: string;
  urlLabel: string;
  copy: string;
  copied: string;
  create: string;
  creating: string;
  clientId: string;
  clientSecret: string;
  secretOnce: string;
  revoke: string;
  revokeConfirm: string;
  revoked: string;
  activeSessions: string;
  needSignIn: string;
  error: string;
  replaced: string;
}

export const geminiMcpCopy: Record<'en' | 'id' | 'fr' | 'zh', GeminiMcpCopy> = {
  en: {
    title: 'Connect to Gemini MCP',
    description: 'Paste this server URL into Gemini. If Gemini asks for a client id and secret, create them here. The secret is shown once.',
    urlLabel: 'MCP server URL',
    copy: 'Copy',
    copied: 'Copied',
    create: 'Create credentials',
    creating: 'Creating…',
    clientId: 'Client ID',
    clientSecret: 'Client secret',
    secretOnce: 'Shown once. Copy it now. Health-tracker stores only a hash.',
    revoke: 'Revoke Gemini access',
    revokeConfirm: 'Click again to revoke',
    revoked: 'Gemini access revoked',
    activeSessions: 'Active sessions: {count}',
    needSignIn: 'Sign in to create credentials.',
    error: 'That did not work. Try again.',
    replaced: 'This secret replaces the previous credentials.',
  },
  id: {
    title: 'Hubungkan ke Gemini MCP',
    description: 'Tempel URL server ini ke Gemini. Jika Gemini meminta client id dan secret, buat di sini. Secret hanya ditampilkan sekali.',
    urlLabel: 'URL server MCP',
    copy: 'Salin',
    copied: 'Tersalin',
    create: 'Buat kredensial',
    creating: 'Membuat…',
    clientId: 'ID klien',
    clientSecret: 'Rahasia klien',
    secretOnce: 'Ditampilkan sekali. Salin sekarang. Health-tracker hanya menyimpan hash.',
    revoke: 'Cabut akses Gemini',
    revokeConfirm: 'Klik lagi untuk mencabut',
    revoked: 'Akses Gemini dicabut',
    activeSessions: 'Sesi aktif: {count}',
    needSignIn: 'Masuk untuk membuat kredensial.',
    error: 'Gagal. Coba lagi.',
    replaced: 'Rahasia ini menggantikan kredensial sebelumnya.',
  },
  fr: {
    title: 'Connecter à Gemini MCP',
    description: 'Collez cette URL de serveur dans Gemini. Si Gemini demande un client id et un secret, créez-les ici. Le secret ne s’affiche qu’une fois.',
    urlLabel: 'URL du serveur MCP',
    copy: 'Copier',
    copied: 'Copié',
    create: 'Créer les identifiants',
    creating: 'Création…',
    clientId: 'ID client',
    clientSecret: 'Secret client',
    secretOnce: 'Affiché une seule fois. Copiez-le maintenant. Health-tracker ne conserve qu’un hash.',
    revoke: 'Révoquer l’accès Gemini',
    revokeConfirm: 'Cliquez encore pour révoquer',
    revoked: 'Accès Gemini révoqué',
    activeSessions: 'Sessions actives : {count}',
    needSignIn: 'Connectez-vous pour créer les identifiants.',
    error: 'Échec. Réessayez.',
    replaced: 'Ce secret remplace les identifiants précédents.',
  },
  zh: {
    title: '连接到 Gemini MCP',
    description: '把这个服务器地址粘贴到 Gemini。如果 Gemini 要求客户端 ID 和密钥，在这里创建。密钥只显示一次。',
    urlLabel: 'MCP 服务器地址',
    copy: '复制',
    copied: '已复制',
    create: '创建凭据',
    creating: '正在创建…',
    clientId: '客户端 ID',
    clientSecret: '客户端密钥',
    secretOnce: '只显示一次。请马上复制。Health-tracker 只保存哈希。',
    revoke: '撤销 Gemini 访问',
    revokeConfirm: '再次点击以撤销',
    revoked: '已撤销 Gemini 访问',
    activeSessions: '活动会话：{count}',
    needSignIn: '请先登录，再创建凭据。',
    error: '无法完成。请再试一次。',
    replaced: '新的密钥已替换上一组凭据。',
  },
};

export function geminiMcpText(language: string | undefined): GeminiMcpCopy {
  if (language === 'id' || language === 'fr' || language === 'zh') return geminiMcpCopy[language];
  return geminiMcpCopy.en;
}

export const CANONICAL_MCP_URL = 'https://health-tracker.co.uk/api/mcp';
