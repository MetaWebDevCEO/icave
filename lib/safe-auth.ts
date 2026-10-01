import type {
  PostgrestError,
  SupabaseClient,
} from "@supabase/supabase-js";
import {
  createClient as createAdminClient,
} from "@supabase/supabase-js";
import { isSchemaMismatchPostgres } from "./submission-files";

type AuthErrorLike = {
  code?: unknown;
  message?: string | null;
  name?: string | null;
};

/**
 * Detecta errores de "schema cache stale" / columna faltante / tabla faltante
 * que Supabase arroja cuando el esquema Postgres cambió y el caché de PostgREST
 * no fue invalidado. Sirve para lanzar reintentos o usar clientes alternativos.
 */
export function isSchemaStaleError(err: AuthErrorLike | unknown | null): boolean {
  if (!err) return false;
  const e = err as AuthErrorLike;
  const code = typeof e.code === "string" ? e.code : "";
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  const name = typeof e.name === "string" ? e.name.toLowerCase() : "";
  if (isSchemaMismatchPostgres({ code, message: msg })) return true;
  if (code === "PGRST204" || code === "42P01" || code === "42703") return true;
  if (msg.includes("schema cache")) return true;
  if (msg.includes("could not find") && msg.includes("cache")) return true;
  if (msg.includes("stale") && msg.includes("schema")) return true;
  if (msg.includes("does not exist") && (msg.includes("relation") || msg.includes("column"))) {
    return true;
  }
  if (name.includes("auth") && msg.includes("session")) return false;
  return false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Construye un cliente Supabase con SERVICE ROLE (bypass de RLS).
 * Devuelve `null` si no hay SUPABASE_SERVICE_ROLE_KEY configurada.
 */
export function makeAdminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (
    !url ||
    !serviceKey ||
    url.includes("__REPLACE_ME__") ||
    serviceKey.includes("__REPLACE_ME__") ||
    serviceKey.length < 20
  ) {
    return null;
  }
  try {
    return createAdminClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Obtiene el usuario autenticado con reintentos exponenciales para mitigar
 * errores transitorios de "schema cache" en el servidor de Supabase.
 */
export async function safeGetUser(
  client: SupabaseClient,
  maxRetries = 3
): Promise<{
  user: { id: string; email?: string | null; user_metadata?: unknown } | null;
  error: AuthErrorLike | null;
  attempts: number;
}> {
  let attempts = 0;
  let lastError: AuthErrorLike | null = null;
  while (attempts < Math.max(1, maxRetries)) {
    attempts++;
    try {
      const resp = await client.auth.getUser();
      const err = resp.error as unknown as AuthErrorLike | null;
      if (!err && resp.data?.user) {
        return { user: resp.data.user, error: null, attempts };
      }
      if (err && !isSchemaStaleError(err)) {
        return { user: null, error: err, attempts };
      }
      if (err) lastError = err;
    } catch (e) {
      const asErr =
        e instanceof Error
          ? ({ message: e.message, name: e.name, code: (e as { code?: unknown }).code } as AuthErrorLike)
          : ({ message: String(e) } as AuthErrorLike);
      if (!isSchemaStaleError(asErr)) {
        return { user: null, error: asErr, attempts };
      }
      lastError = asErr;
    }
    if (attempts < maxRetries) await sleep(250 * attempts);
  }
  return { user: null, error: lastError, attempts };
}

export type SafeQuerySelectOpts<T> = {
  retries?: number;
  label?: string;
  defaultData: T;
  /** Cliente primario (normalmente admin). Si falla usamos anon. */
  primaryClient?: SupabaseClient | null;
  /** Cliente fallback (anon). */
  fallbackClient?: SupabaseClient | null;
};

/**
 * Ejecuta una consulta .select() sencilla con reintentos y cascadeo de clientes
 * (primaryClient → fallbackClient) contra errores de schema cache.
 */
export async function safeQuerySelect<T>(
  run: (client: SupabaseClient) => Promise<{
    data?: unknown | null;
    error?: PostgrestError | null;
  }>,
  opts: SafeQuerySelectOpts<T>
): Promise<{ data: T; error: PostgrestError | null; attempts: number; usedAdmin: boolean }> {
  const retries = Math.max(1, opts.retries ?? 2);
  const label = opts.label ?? "safeQuerySelect";
  const candidates: SupabaseClient[] = [];
  if (opts.primaryClient) candidates.push(opts.primaryClient);
  if (opts.fallbackClient) candidates.push(opts.fallbackClient);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (candidates.length === 0 && url && anonKey && !url.includes("__REPLACE_ME__") && !anonKey.includes("__REPLACE_ME__")) {
    const builtInAnon = createAdminClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    candidates.push(builtInAnon);
  }

  let lastErr: PostgrestError | null = null;
  let usedAdmin = false;
  let attempts = 0;

  for (let ci = 0; ci < candidates.length; ci++) {
    const client = candidates[ci];
    if (!client) continue;
    if (ci === 0 && opts.primaryClient === client) usedAdmin = true;
    else usedAdmin = false;
    for (let r = 0; r < retries; r++) {
      attempts++;
      try {
        const res = await run(client);
        const err = (res.error ?? null) as PostgrestError | null;
        if (!err) {
          return {
            data: (res.data as T) ?? opts.defaultData,
            error: null,
            attempts,
            usedAdmin,
          };
        }
        lastErr = err;
        const msg = (err.message ?? "").toString().toLowerCase();
        const isRetryable =
          isSchemaMismatchPostgres(err) ||
          err.code === "42501" ||
          err.code === "PGRST301" ||
          msg.includes("row level security");
        if (!isRetryable) break;
        if (r < retries - 1) await sleep(200 * (r + 1));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const baseErr = new Error(msg) as Error & { toJSON?: () => Record<string, unknown> };
        if (typeof baseErr.toJSON !== "function") {
          baseErr.toJSON = function () {
            return { message: msg };
          };
        }
        const asPgErr = Object.assign(
          baseErr,
          {
            code: "",
            details: "",
            hint: "",
            message: msg,
          }
        ) as unknown as PostgrestError;
        lastErr = asPgErr;
        if (r < retries - 1) await sleep(200 * (r + 1));
      }
    }
  }

  console.warn(
    `[safe-auth:safeQuerySelect:${label}] Fallback a defaultData tras ${attempts} intentos. Último error:`,
    lastErr?.message ?? "desconocido"
  );
  return {
    data: opts.defaultData,
    error: lastErr,
    attempts,
    usedAdmin,
  };
}

type SafeListUsersOpts = {
  perPage?: number;
  page?: number;
  label?: string;
};

export type SafeAuthUser = {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown> | null;
  role?: string | null;
};

/**
 * Lista usuarios desde auth.admin.listUsers con reintentos y fallback robusto
 * ante errores de schema cache o falta de SUPABASE_SERVICE_ROLE_KEY.
 * Si el admin client no está disponible, devuelve un array vacío para que
 * el caller active su propio fallback.
 */
export async function safeListUsers(
  opts: SafeListUsersOpts = {}
): Promise<SafeAuthUser[]> {
  const perPage = opts.perPage ?? 500;
  const page = opts.page ?? 1;
  const label = opts.label ?? "safeListUsers";
  const admin = makeAdminClientOrNull();
  if (!admin) {
    console.warn(`[safe-auth:${label}] Service role key no disponible → listUsers=[]`);
    return [];
  }
  const retries = 3;
  let lastErr: unknown = null;
  for (let r = 0; r < retries; r++) {
    try {
      const listResp = await (admin.auth as unknown as {
        admin: {
          listUsers: (args: {
            page: number;
            perPage: number;
          }) => Promise<{ data?: { users?: Array<unknown> } | null }>;
        };
      }).admin.listUsers({ page, perPage });
      const rawUsers = ((listResp.data?.users ?? []) as Array<{
        id?: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
        role?: string | null;
      }>) || [];
      const out: SafeAuthUser[] = [];
      for (const u of rawUsers) {
        if (!u.id) continue;
        out.push({
          id: u.id,
          email: typeof u.email === "string" ? u.email : null,
          user_metadata:
            u.user_metadata && typeof u.user_metadata === "object"
              ? (u.user_metadata as Record<string, unknown>)
              : null,
          role: typeof u.role === "string" ? u.role : null,
        });
      }
      return out;
    } catch (e) {
      lastErr = e;
      const asErr: AuthErrorLike =
        e instanceof Error
          ? ({ message: e.message, name: e.name, code: (e as { code?: unknown }).code } as AuthErrorLike)
          : ({ message: String(e) } as AuthErrorLike);
      if (!isSchemaStaleError(asErr)) break;
      if (r < retries - 1) await sleep(300 * (r + 1));
    }
  }
  console.warn(
    `[safe-auth:${label}] safeListUsers falló tras ${retries} intentos. Error:`,
    lastErr instanceof Error ? lastErr.message : String(lastErr)
  );
  return [];
}

export type SafeFullAuthUser = {
  id: string;
  email: string | null;
  createdAt: string | null;
  user_metadata: Record<string, unknown> | null;
  role?: string | null;
};

async function waitMs(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Hace getUserById secuencialmente por batch pequeño para no saturar a GoTrue
 * (listUsers suele fallar con "Database error finding users" en entornos
 * locales/small projects) y reintenta individualmente los IDs que fallan.
 *
 * Devuelve un Map indexado por id con TODOS los usuarios que se pudieron
 * resolver desde auth.users. Quien llama decide si completar faltantes con
 * datos huérfanos de user_roles/profiles/asignaciones.
 */
export async function safeFillMissingUsersById(
  admin: SupabaseClient | null | undefined,
  knownUserIds: string[],
  existingMap?: Map<string, SafeFullAuthUser>,
  opts: { label?: string } = {}
): Promise<Map<string, SafeFullAuthUser>> {
  const label = opts.label ?? "safeFillMissingUsersById";
  const out = new Map<string, SafeFullAuthUser>(existingMap ?? []);
  if (!admin) return out;

  const uniqIds = Array.from(new Set(knownUserIds)).filter(Boolean);
  const missing = uniqIds.filter((id) => !out.has(id));
  if (missing.length === 0) return out;

  const BATCH = 8;
  const BATCH_PAUSE_MS = 900;
  const PER_ID_RETRIES = 7;

  let successBatch = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map(async (uid) => {
        const r = await (admin.auth as unknown as {
          admin: {
            getUserById: (
              id: string
            ) => Promise<{
              data?: { user?: Record<string, unknown> | null } | null;
              error?: { message?: string | null } | null;
            }>;
          };
        }).admin.getUserById(uid);
        if (r?.error || !r?.data?.user) {
          throw new Error(r?.error?.message ?? `no-user ${uid}`);
        }
        const u = r.data.user as Record<string, unknown> & {
          id?: string;
          email?: string | null;
          created_at?: string | null;
          user_metadata?: Record<string, unknown> | null;
          role?: string | null;
        };
        if (!u.id) throw new Error(`no-id ${uid}`);
        return {
          id: u.id,
          email: typeof u.email === "string" ? u.email : null,
          createdAt: typeof u.created_at === "string" ? u.created_at : null,
          user_metadata:
            u.user_metadata && typeof u.user_metadata === "object"
              ? (u.user_metadata as Record<string, unknown>)
              : null,
          role: typeof u.role === "string" ? u.role : null,
        } satisfies SafeFullAuthUser;
      })
    );
    for (const res of results) {
      if (res.status === "fulfilled") {
        out.set(res.value.id, res.value);
        successBatch++;
      }
    }
    if (i + BATCH < missing.length) await waitMs(BATCH_PAUSE_MS);
  }

  const stillMissing = uniqIds.filter((id) => !out.has(id));
  if (stillMissing.length > 0) {
    console.debug(
      `[safe-auth:${label}] Batch getUserById resolvió ${successBatch}/${missing.length}.`,
      `Reintento individual con ${PER_ID_RETRIES} intentos (backoff exponencial) sobre ${stillMissing.length} IDs faltantes...`
    );
    let perIdOk = 0;
    for (const uid of stillMissing) {
      let resolved: SafeFullAuthUser | null = null;
      for (let t = 0; t < PER_ID_RETRIES && !resolved; t++) {
        try {
          const r = await (admin.auth as unknown as {
            admin: {
              getUserById: (
                id: string
              ) => Promise<{
                data?: { user?: Record<string, unknown> | null } | null;
                error?: { message?: string | null } | null;
              }>;
            };
          }).admin.getUserById(uid);
          const errorMsg = r?.error?.message;
          const isRate =
            typeof errorMsg === "string" &&
            (errorMsg.includes("rate") || errorMsg.includes("too many") || errorMsg.includes("429"));
          if (!r?.error && r?.data?.user) {
            const u = r.data.user as Record<string, unknown> & {
              id?: string;
              email?: string | null;
              created_at?: string | null;
              user_metadata?: Record<string, unknown> | null;
              role?: string | null;
            };
            if (u.id) {
              resolved = {
                id: u.id,
                email: typeof u.email === "string" ? u.email : null,
                createdAt: typeof u.created_at === "string" ? u.created_at : null,
                user_metadata:
                  u.user_metadata && typeof u.user_metadata === "object"
                    ? (u.user_metadata as Record<string, unknown>)
                    : null,
                role: typeof u.role === "string" ? u.role : null,
              };
            }
          } else if (isRate && t < PER_ID_RETRIES - 1) {
            console.debug(`[safe-auth:${label}] ${uid} rate-limited (t=${t}); backoff extra.`);
          }
        } catch (e) {
          /* sigue reintentando */
        }
        if (!resolved && t < PER_ID_RETRIES - 1) {
          const base = 800 * Math.pow(2, t);
          await waitMs(base + Math.floor(Math.random() * 400));
        }
      }
      if (resolved) {
        out.set(resolved.id, resolved);
        perIdOk++;
      } else {
        console.debug(
          `[safe-auth:${label}] getUserById persistió fallo para uid=${uid} tras ${PER_ID_RETRIES} intentos (se omitirá; el caller puede armar ghost con datos de user_roles/asignaciones si desea).`
        );
      }
    }
    console.debug(
      `[safe-auth:${label}] Reintento individual OK: ${perIdOk}/${stillMissing.length}.`
    );
  }

  return out;
}
