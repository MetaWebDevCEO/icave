import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  buildSections,
  type UserRole,
  strongCheckIsRevisor,
} from "@/lib/platform-roles";
import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { isSchemaMismatchPostgres } from "@/lib/submission-files";
import { AsignacionForm } from "./asignacion-form";
import { unstable_cache } from "next/cache";

export const revalidate = 30;

type MatrizRow = {
  id?: string | number | null;
  created_at?: string | null;
  actividad?: string | null;
  frecuencia?: string | null;
  [key: string]: unknown;
};

const SELECT_MATRIZ_EXTENDED = "id, created_at, actividad, frecuencia";
const SELECT_MATRIZ_BASE = "id, actividad, frecuencia";

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_SIGNED_URL_EXPIRES_SECONDS = 60 * 10;

const CANONICAL_SUPERVISOR_ROLE_CODES = new Set<string>([
  "2",
  "supervisor",
  "usuario",
  "admin",
  "administrador",
  "sup",
  "s",
]);

function buildSupabase(url: string, key: string): SupabaseClient | null {
  if (!url || !key) return null;
  return createSupabaseAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeEmailLocal(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function metadataLooksSupervisorLocal(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role.trim().toLowerCase() : "";
  const rol = typeof m.rol === "string" ? m.rol.trim().toLowerCase() : "";
  const rolId =
    typeof m.rol_id === "string"
      ? m.rol_id.trim()
      : typeof m.rol_id === "number"
        ? String(m.rol_id)
        : "";
  const roleId =
    typeof m.role_id === "string"
      ? m.role_id.trim()
      : typeof m.role_id === "number"
        ? String(m.role_id)
        : "";

  if (role === "supervisor" || rol === "supervisor") return true;
  if (roleId === "2" || rolId === "2") return true;
  if (roleId === "6" || rolId === "6") return true;
  return false;
}

function deriveDisplayNameLocal(
  email: string | null | undefined,
  metadata: Record<string, unknown> | null
): string {
  const metadataName =
    metadata && typeof metadata.full_name === "string"
      ? metadata.full_name
      : metadata && typeof metadata.display_name === "string"
        ? metadata.display_name
        : metadata && typeof metadata.name === "string"
          ? metadata.name
          : "";
  if (metadataName.trim()) return metadataName.trim();
  if (!email) return "Sin nombre";
  const localPart = email.split("@")[0] ?? "supervisor";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isPgSchemaErr(err: PostgrestError | { code?: unknown; message?: string | null } | null) {
  return isSchemaMismatchPostgres(err as { code?: unknown; message?: string | null });
}

// ===================== CACHÉ GLOBAL =====================

const getCachedMatriz = unstable_cache(
  async (
    sbUrl: string,
    anonKey: string,
    serviceKey: string
  ): Promise<{ matrizOptions: { id: number; actividad: string }[] }> => {
    const admin = buildSupabase(sbUrl, serviceKey);
    const anon = buildSupabase(sbUrl, anonKey);
    const client: SupabaseClient | null = admin ?? anon;
    const empty: { matrizOptions: { id: number; actividad: string }[] } = {
      matrizOptions: Array.from({ length: 64 }, (_, i) => ({
        id: i + 1,
        actividad: "",
      })),
    };
    if (!client) return empty;

    let rows: MatrizRow[] = [];
    try {
      const extended = await client
        .from("matriz")
        .select(SELECT_MATRIZ_EXTENDED)
        .limit(500);
      if (!isPgSchemaErr(extended.error)) {
        rows = (extended.data ?? []) as MatrizRow[];
      } else {
        const base = await client
          .from("matriz")
          .select(SELECT_MATRIZ_BASE)
          .limit(500);
        rows = (base.data ?? []) as MatrizRow[];
      }
    } catch {
      rows = [];
    }

    const byId = new Map<number, { id: number; actividad: string }>();
    for (const r of rows) {
      const rawId = r.id;
      let numericId: number | null = null;
      if (typeof rawId === "number" && Number.isFinite(rawId)) {
        numericId = Math.round(rawId);
      } else if (typeof rawId === "string") {
        const n = Number(rawId.trim());
        if (Number.isFinite(n)) numericId = Math.round(n);
      }
      if (numericId === null || numericId < 1 || numericId > 64) continue;
      const actividadRaw = r.actividad;
      const actividad =
        typeof actividadRaw === "string" ? actividadRaw.trim() : "";
      const existing = byId.get(numericId);
      if (
        !existing ||
        (actividad.length > 0 && existing.actividad.length === 0)
      ) {
        byId.set(numericId, { id: numericId, actividad });
      }
    }
    const matrizOptions: { id: number; actividad: string }[] = [];
    for (let i = 1; i <= 64; i++) {
      const row = byId.get(i);
      matrizOptions.push({ id: i, actividad: row?.actividad ?? "" });
    }
    return { matrizOptions };
  },
  ["asignacion-matriz-64-v3"],
  { revalidate: 60 * 10, tags: ["matriz"] }
);

const getCachedSupervisorSources = unstable_cache(
  async (
    sbUrl: string,
    anonKey: string,
    serviceKey: string
  ): Promise<{
    supervisorUserIds: string[];
    supervisorEmails: string[];
    revisorUserIds: string[];
    catalogSupervisorCodes: string[];
    catalogRolesLen: number;
    userRoleRowsLen: number;
    profileRowsLen: number;
    asignacionesRowsLen: number;
    assignmentAssignedEmails: string[];
  }> => {
    const admin = buildSupabase(sbUrl, serviceKey);
    const anon = buildSupabase(sbUrl, anonKey);
    const client: SupabaseClient | null = admin ?? anon;
    const emptyResult = {
      supervisorUserIds: [],
      supervisorEmails: [],
      revisorUserIds: [],
      catalogSupervisorCodes: [],
      catalogRolesLen: 0,
      userRoleRowsLen: 0,
      profileRowsLen: 0,
      asignacionesRowsLen: 0,
      assignmentAssignedEmails: [],
    };
    if (!client) return emptyResult;

    type CatalogRoleRow = { id?: unknown; code?: unknown; name?: unknown };
    let catalogRoles: CatalogRoleRow[] = [];
    try {
      const r = await client.from("roles").select("id, code, name").limit(50);
      catalogRoles = (r.data ?? []) as CatalogRoleRow[];
    } catch {
      catalogRoles = [];
    }

    const supervisorRoleCodes = new Set<string>(CANONICAL_SUPERVISOR_ROLE_CODES);
    for (const r of catalogRoles) {
      const idNum =
        typeof r.id === "number"
          ? r.id
          : typeof r.id === "string"
            ? Number(r.id)
            : NaN;
      const nameStr =
        typeof r.name === "string" ? r.name.trim().toLowerCase() : "";
      const codeStr =
        typeof r.code === "string" ? r.code.trim() : String(r.code ?? "");
      const esFilaSupervisor = idNum === 6 || nameStr === "supervisor";
      if (esFilaSupervisor && codeStr) {
        supervisorRoleCodes.add(codeStr);
        supervisorRoleCodes.add(codeStr.toLowerCase());
      }
    }

    type UserRoleRow = { user_id?: unknown; role_code?: unknown; role?: unknown; rol?: unknown; user_role?: unknown; tipo?: unknown; type?: unknown };
    let userRoleRows: UserRoleRow[] = [];
    try {
      const ext = await client
        .from("user_roles")
        .select("user_id, role_code, role, rol, user_role, tipo, type, created_at, updated_at")
        .limit(1000);
      if (!isPgSchemaErr(ext.error)) {
        userRoleRows = (ext.data ?? []) as UserRoleRow[];
      } else {
        const base = await client
          .from("user_roles")
          .select("user_id, role_code")
          .limit(1000);
        userRoleRows = (base.data ?? []) as UserRoleRow[];
      }
    } catch {
      userRoleRows = [];
    }

    const supervisorUserIds = new Set<string>();
    const supervisorEmails = new Set<string>();
    const revisorUserIds = new Set<string>();

    for (const row of userRoleRows) {
      const uid = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (!uid) continue;
      const candidates = [
        row.role_code,
        row.role,
        row.rol,
        row.user_role,
        row.tipo,
        row.type,
      ];
      let matched: "supervisor" | "revisor" | null = null;
      for (const c of candidates) {
        const rcStr =
          typeof c === "string"
            ? c.trim()
            : typeof c === "number"
              ? String(c)
              : "";
        if (!rcStr) continue;
        const isRev =
          rcStr === "1" ||
          rcStr.toLowerCase() === "revisor" ||
          rcStr.toLowerCase() === "reviewer" ||
          rcStr.toLowerCase() === "rev" ||
          rcStr.toLowerCase() === "r";
        if (isRev) {
          matched = "revisor";
          break;
        }
        const isSup =
          supervisorRoleCodes.has(rcStr) ||
          supervisorRoleCodes.has(rcStr.toLowerCase());
        if (isSup) {
          matched = "supervisor";
          break;
        }
      }
      if (matched === "supervisor") supervisorUserIds.add(uid);
      else if (matched === "revisor") revisorUserIds.add(uid);
    }

    type ProfileRow = { id?: unknown; user_id?: unknown; role_code?: unknown; rol?: unknown; role?: unknown; email?: unknown };
    let profileRows: ProfileRow[] = [];
    try {
      const r = await client
        .from("profiles")
        .select("id, user_id, role_code, rol, role, email")
        .limit(1000);
      if (!isPgSchemaErr(r.error)) {
        profileRows = (r.data ?? []) as ProfileRow[];
      } else {
        profileRows = [];
      }
    } catch {
      profileRows = [];
    }

    for (const p of profileRows) {
      const uid =
        typeof p.user_id === "string"
          ? p.user_id.trim()
          : typeof p.id === "string"
            ? p.id.trim()
            : "";
      if (!uid) continue;
      const fields = [p.role_code, p.rol, p.role];
      let found = false;
      for (const f of fields) {
        const rcStr =
          typeof f === "string"
            ? f.trim()
            : typeof f === "number"
              ? String(f)
              : "";
        if (!rcStr) continue;
        if (
          supervisorRoleCodes.has(rcStr) ||
          supervisorRoleCodes.has(rcStr.toLowerCase())
        ) {
          found = true;
          break;
        }
      }
      if (found) {
        supervisorUserIds.add(uid);
        const email = normalizeEmailLocal(
          typeof p.email === "string" ? p.email : null
        );
        if (email) supervisorEmails.add(email);
      }
    }

    type AsigRow = { assigned_to_email?: unknown };
    let asignacionesRows: AsigRow[] = [];
    try {
      const r = await client
        .from("asignaciones")
        .select("assigned_to_email")
        .limit(10000);
      if (!isPgSchemaErr(r.error)) {
        asignacionesRows = (r.data ?? []) as AsigRow[];
      }
    } catch {
      asignacionesRows = [];
    }
    const uniqueAssignmentEmails = new Set<string>();
    for (const a of asignacionesRows) {
      const email = normalizeEmailLocal(
        typeof a.assigned_to_email === "string" ? a.assigned_to_email : null
      );
      if (email) {
        uniqueAssignmentEmails.add(email);
        supervisorEmails.add(email);
      }
    }

    return {
      supervisorUserIds: Array.from(supervisorUserIds),
      supervisorEmails: Array.from(supervisorEmails),
      revisorUserIds: Array.from(revisorUserIds),
      catalogSupervisorCodes: Array.from(supervisorRoleCodes),
      catalogRolesLen: catalogRoles.length,
      userRoleRowsLen: userRoleRows.length,
      profileRowsLen: profileRows.length,
      asignacionesRowsLen: asignacionesRows.length,
      assignmentAssignedEmails: Array.from(uniqueAssignmentEmails),
    };
  },
  ["asignacion-supervisor-sources-v3"],
  { revalidate: 60 * 2, tags: ["supervisores", "asignaciones", "profiles", "roles"] }
);

const getCachedAuthUsers = unstable_cache(
  async (
    sbUrl: string,
    _anonKey: string,
    serviceKey: string,
    supervisorIds: string[]
  ): Promise<{
    allUsers: {
      id: string;
      email: string | null;
      emailNormalized: string;
      displayName: string;
      avatarBucket: string;
      avatarPath: string;
      fallbackAvatar: string | null;
      metaSupervisor: boolean;
    }[];
  }> => {
    const allUsers: {
      id: string;
      email: string | null;
      emailNormalized: string;
      displayName: string;
      avatarBucket: string;
      avatarPath: string;
      fallbackAvatar: string | null;
      metaSupervisor: boolean;
    }[] = [];
    const admin = buildSupabase(sbUrl, serviceKey);
    if (!admin) return { allUsers };

    const pushFromU = (u: {
      id: string;
      email?: string | null;
      user_metadata?: {
        full_name?: string;
        name?: string;
        display_name?: string;
        avatar_bucket?: string;
        avatar_path?: string;
        avatar_url?: string;
        picture?: string;
        role?: unknown;
        rol?: unknown;
        role_id?: unknown;
        rol_id?: unknown;
      } | null;
    }) => {
      if (!u.id) return;
      const meta =
        u.user_metadata && typeof u.user_metadata === "object"
          ? (u.user_metadata as Record<string, unknown>)
          : null;
      const bucket =
        meta && typeof meta.avatar_bucket === "string"
          ? meta.avatar_bucket.trim()
          : "";
      const path =
        meta && typeof meta.avatar_path === "string"
          ? meta.avatar_path.trim()
          : "";
      const fallbackPicture =
        meta &&
        (typeof (meta as { avatar_url?: unknown }).avatar_url === "string"
          ? (meta as { avatar_url: string }).avatar_url
          : typeof (meta as { picture?: unknown }).picture === "string"
            ? (meta as { picture: string }).picture
            : null);
      allUsers.push({
        id: u.id,
        email: u.email ?? null,
        emailNormalized: normalizeEmailLocal(u.email),
        displayName: deriveDisplayNameLocal(u.email ?? null, meta),
        avatarBucket: bucket || DEFAULT_AVATAR_BUCKET,
        avatarPath: path,
        fallbackAvatar: fallbackPicture ?? null,
        metaSupervisor: metadataLooksSupervisorLocal(meta),
      });
    };

    try {
      const listed = await (admin.auth as unknown as {
        admin: {
          listUsers?: (args: {
            page: number;
            perPage: number;
          }) => Promise<{ data?: { users?: Array<unknown> } | null }>;
          getUserById?: (
            id: string
          ) => Promise<{ data?: { user?: unknown } | null; error?: unknown | null }>;
        };
      }).admin;

      let foundByList = false;
      try {
        const listResp = await listed?.listUsers?.({
          page: 1,
          perPage: 1000,
        });
        const users = (listResp?.data?.users ?? []) as Array<{
          id: string;
          email?: string | null;
          user_metadata?: {
            full_name?: string;
            name?: string;
            display_name?: string;
            avatar_bucket?: string;
            avatar_path?: string;
            avatar_url?: string;
            picture?: string;
            role?: unknown;
            rol?: unknown;
            role_id?: unknown;
            rol_id?: unknown;
          } | null;
        }>;
        if (Array.isArray(users) && users.length > 0) {
          for (const u of users) pushFromU(u);
          foundByList = allUsers.length > 0;
        }
      } catch {
        /* ignore listUsers error -> fallback */
      }

      if (!foundByList && supervisorIds.length > 0) {
        const ids = supervisorIds.slice(0, 100);
        for (const uid of ids) {
          try {
            const r = await listed?.getUserById?.(uid);
            const u = r?.data?.user as {
              id: string;
              email?: string | null;
              user_metadata?: {
                full_name?: string;
                name?: string;
                display_name?: string;
                avatar_bucket?: string;
                avatar_path?: string;
                avatar_url?: string;
                picture?: string;
                role?: unknown;
                rol?: unknown;
                role_id?: unknown;
                rol_id?: unknown;
              } | null;
            } | undefined;
            if (u?.id) pushFromU(u);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      console.warn(
        "[asignacion] auth.users fallback:",
        e instanceof Error ? e.message : String(e)
      );
    }
    return { allUsers };
  },
  ["asignacion-auth-users-v3"],
  { revalidate: 60 * 5, tags: ["auth-users"] }
);

const getCachedSignedAvatar = unstable_cache(
  async (
    urlBase: string,
    serviceKey: string,
    anonKey: string,
    bucket: string,
    path: string
  ): Promise<string | null> => {
    if (!bucket || !path) return null;
    try {
      const anon = buildSupabase(urlBase, anonKey);
      if (anon) {
        const signedA = await anon.storage
          .from(bucket)
          .createSignedUrl(path, AVATAR_SIGNED_URL_EXPIRES_SECONDS);
        if (signedA.data?.signedUrl && !signedA.error) {
          return signedA.data.signedUrl;
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const admin = buildSupabase(urlBase, serviceKey);
      if (admin) {
        const signedB = await admin.storage
          .from(bucket)
          .createSignedUrl(path, AVATAR_SIGNED_URL_EXPIRES_SECONDS);
        if (signedB.data?.signedUrl && !signedB.error) {
          return signedB.data.signedUrl;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  },
  ["asignacion-avatar-signed-v3"],
  { revalidate: 8 * 3600, tags: ["avatars-signed"] }
);

// ===================== PAGE =====================
export default async function AsignacionPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (
    !url ||
    !anonKey ||
    url.includes("__REPLACE_ME__") ||
    anonKey.includes("__REPLACE_ME__")
  ) {
    return redirect(
      "/?error=" + encodeURIComponent("Configura Supabase primero (env vars).")
    );
  }

  const supabase = await createClient();

  let user: { id: string; email?: string | null; user_metadata?: unknown } | null =
    null;
  try {
    const resp = await supabase.auth.getUser();
    if (!resp.error && resp.data?.user) {
      user = resp.data.user;
    } else if (resp.error) {
      console.debug("[asignacion] getUser error:", resp.error.message);
    }
  } catch (e) {
    console.debug(
      "[asignacion] getUser exception:",
      e instanceof Error ? e.message : String(e)
    );
  }

  if (!user) {
    return redirect("/auth/login");
  }

  let sections: SidebarSection[] = [];
  try {
    const strongCheck = await strongCheckIsRevisor(supabase, user.id, {
      email: user.email ?? null,
    });
    const role: UserRole = strongCheck.decidedRole;
    if (role !== "revisor") {
      return redirect(
        "/platform?error=" +
          encodeURIComponent("Esta sección es sólo para revisores.")
      );
    }
    sections = buildSections(role);
  } catch (e) {
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string") {
      if (digest.startsWith("NEXT_REDIRECT")) {
        console.debug("[asignacion] strongCheck lanzó NEXT_REDIRECT, no re-lanzamos.");
      } else if (digest.startsWith("NEXT_NOTFOUND")) {
        console.debug("[asignacion] strongCheck lanzó NEXT_NOTFOUND, no re-lanzamos.");
      }
    } else {
      console.debug(
        "[asignacion] strongCheck exception:",
        e instanceof Error ? e.message : String(e)
      );
    }
    sections = buildSections("revisor");
  }

  let matrizOptions: { id: number; actividad: string }[] = [];
  let supervisorUserIds: string[] = [];
  let supervisorEmails: string[] = [];
  let revisorUserIds: string[] = [];
  let catalogSupervisorCodes: string[] = [];
  let catalogRolesLen = 0;
  let userRoleRowsLen = 0;
  let profileRowsLen = 0;
  let asignacionesRowsLen = 0;
  let assignmentAssignedEmails: string[] = [];
  let allUsers: Array<{
    id: string;
    email: string | null;
    emailNormalized: string | null;
    displayName: string;
    avatarBucket: string;
    avatarPath: string;
    fallbackAvatar: string | null;
    metaSupervisor: boolean;
  }> = [];

  type SupervisorOption = {
    id: string;
    email: string | null;
    displayName: string;
    avatarUrl: string | null;
    avatarBucket: string;
    avatarPath: string;
    fallbackAvatar: string | null;
  };
  let supervisores: SupervisorOption[] = [];
  let revisorAvatarUrl: string | null = null;

  try {
    const [matrizRes, sourcesRes] = await Promise.all([
      getCachedMatriz(url, anonKey, serviceKey),
      getCachedSupervisorSources(url, anonKey, serviceKey),
    ]);
    matrizOptions = matrizRes.matrizOptions;
    supervisorUserIds = sourcesRes.supervisorUserIds;
    supervisorEmails = sourcesRes.supervisorEmails;
    revisorUserIds = sourcesRes.revisorUserIds;
    catalogSupervisorCodes = sourcesRes.catalogSupervisorCodes;
    catalogRolesLen = sourcesRes.catalogRolesLen;
    userRoleRowsLen = sourcesRes.userRoleRowsLen;
    profileRowsLen = sourcesRes.profileRowsLen;
    asignacionesRowsLen = sourcesRes.asignacionesRowsLen;
    assignmentAssignedEmails = sourcesRes.assignmentAssignedEmails;

    const authRes = await getCachedAuthUsers(
      url,
      anonKey,
      serviceKey,
      supervisorUserIds
    );
    allUsers = authRes.allUsers;

    const seenUserIds = new Set<string>();
    const seenEmails = new Set<string>();

    const supervisorUserIdsSet = new Set<string>(supervisorUserIds);
    const supervisorEmailsSet = new Set<string>(supervisorEmails);
    const revisorIdsSet = new Set<string>(revisorUserIds);
    revisorIdsSet.add(user.id);
    const currentUserEmail = normalizeEmailLocal(user.email ?? null);
    if (currentUserEmail) revisorIdsSet.add(`email:${currentUserEmail}`);

    for (const u of allUsers) {
      const byId = supervisorUserIdsSet.has(u.id);
      const byEmail = u.emailNormalized
        ? supervisorEmailsSet.has(u.emailNormalized)
        : false;
      const byMeta = u.metaSupervisor;
      if (!byId && !byEmail && !byMeta) continue;
      if (revisorIdsSet.has(u.id)) continue;
      if (seenUserIds.has(u.id)) continue;
      seenUserIds.add(u.id);
      if (u.emailNormalized) seenEmails.add(u.emailNormalized);
      supervisores.push({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: null,
        avatarBucket: u.avatarBucket,
        avatarPath: u.avatarPath,
        fallbackAvatar: u.fallbackAvatar,
      });
    }

    for (const email of supervisorEmails) {
      if (seenEmails.has(email)) continue;
      if (currentUserEmail && email === currentUserEmail) continue;
      seenEmails.add(email);
      const ghostId = `ghost:${email}`;
      supervisores.push({
        id: ghostId,
        email,
        displayName: deriveDisplayNameLocal(email, null),
        avatarUrl: null,
        avatarBucket: DEFAULT_AVATAR_BUCKET,
        avatarPath: "",
        fallbackAvatar: null,
      });
    }

    if (supervisores.length === 0 && allUsers.length > 0) {
      console.debug(
        "[asignacion:debug] Fallback anti-vacío: usando TODOS auth.users (sin revisores)."
      );
      for (const u of allUsers) {
        if (revisorIdsSet.has(u.id)) continue;
        if (seenUserIds.has(u.id)) continue;
        if (currentUserEmail && u.emailNormalized === currentUserEmail) continue;
        seenUserIds.add(u.id);
        if (u.emailNormalized) seenEmails.add(u.emailNormalized);
        supervisores.push({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          avatarUrl: null,
          avatarBucket: u.avatarBucket,
          avatarPath: u.avatarPath,
          fallbackAvatar: u.fallbackAvatar,
        });
      }
    }

    supervisores.sort((a, b) => {
      const an = a.displayName.toLowerCase();
      const bn = b.displayName.toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    console.debug(
      "[asignacion:debug] ============ Supervisores selector ============"
    );
    console.debug(
      "[asignacion:debug] Service Role Key?",
      Boolean(serviceKey && !serviceKey.includes("__REPLACE_ME__")),
      "| user:",
      user.id.slice(0, 8),
      "| email:",
      normalizeEmailLocal(user.email ?? null)
    );
    console.debug(
      "[asignacion:debug] catalogRoles.len =",
      catalogRolesLen,
      "| supervisorRoleCodes =",
      catalogSupervisorCodes
    );
    console.debug(
      "[asignacion:debug] user_roles.len =",
      userRoleRowsLen,
      "| profiles.len =",
      profileRowsLen,
      "| asignaciones.len =",
      asignacionesRowsLen,
      "| assigned emails únicos =",
      assignmentAssignedEmails.length
    );
    console.debug(
      "[asignacion:debug] allUsers.len =",
      allUsers.length,
      "| metaSupervisor =",
      allUsers.filter((u) => u.metaSupervisor).length
    );
    console.debug(
      "[asignacion:debug] supervisorUserIds.size =",
      supervisorUserIdsSet.size,
      "| supervisorEmails.size =",
      supervisorEmailsSet.size,
      "| revisorIds.size =",
      revisorIdsSet.size
    );
    console.debug(
      "[asignacion:debug] FINAL supervisores.length =",
      supervisores.length
    );
    if (supervisores.length > 0) {
      for (let i = 0; i < Math.min(5, supervisores.length); i++) {
        const s = supervisores[i];
        console.debug(
          `[asignacion:debug]   #${i + 1}: ${s.displayName} <${s.email || "sin email"}> id=${s.id.slice(0, 12)}`
        );
      }
      if (supervisores.length > 5) {
        console.debug(
          `[asignacion:debug]   ... y ${supervisores.length - 5} más.`
        );
      }
    }

    const extractAvatarMetaLocal = (userMetadata: unknown) => {
      const meta =
        userMetadata && typeof userMetadata === "object"
          ? (userMetadata as Record<string, unknown>)
          : null;
      const bucket =
        meta && typeof meta.avatar_bucket === "string"
          ? meta.avatar_bucket.trim()
          : "";
      const path =
        meta && typeof meta.avatar_path === "string"
          ? meta.avatar_path.trim()
          : "";
      const fallbackPicture =
        meta &&
        (typeof (meta as { avatar_url?: unknown }).avatar_url === "string"
          ? (meta as { avatar_url: string }).avatar_url
          : typeof (meta as { picture?: unknown }).picture === "string"
            ? (meta as { picture: string }).picture
            : null);
      return {
        bucket: bucket || DEFAULT_AVATAR_BUCKET,
        path,
        fallbackPicture: fallbackPicture ?? null,
      };
    };

    const revMeta = extractAvatarMetaLocal(user.user_metadata);
    const resolveList = supervisores.map((s) =>
      getCachedSignedAvatar(url, serviceKey, anonKey, s.avatarBucket, s.avatarPath).then(
        (v) => v ?? s.fallbackAvatar
      )
    );
    const resolveAll: Promise<string | null>[] = [
      getCachedSignedAvatar(url, serviceKey, anonKey, revMeta.bucket, revMeta.path).then(
        (v) => v ?? revMeta.fallbackPicture
      ),
      ...resolveList,
    ];
    const resolved = await Promise.allSettled(resolveAll);
    const safeResult = (i: number): string | null => {
      const r = resolved[i];
      if (r.status === "fulfilled") return r.value ?? null;
      return null;
    };
    revisorAvatarUrl = safeResult(0);
    for (let i = 0; i < supervisores.length; i++) {
      supervisores[i].avatarUrl = safeResult(i + 1);
    }
  } catch (e) {
    console.debug(
      "[asignacion] Datos async fallaron (fallback a arrays vacíos):",
      e instanceof Error ? e.message : String(e)
    );
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto w-full max-w-[1400px] px-0 md:px-0 flex flex-col">
        <div className="w-full flex-shrink-0">
          <AsignacionForm
            currentUserId={user.id}
            currentUserEmail={user.email ?? undefined}
            currentUserAvatarUrl={revisorAvatarUrl}
            matrizOptions={matrizOptions}
            supervisores={supervisores.map((s) => ({
              id: s.id,
              email: s.email,
              displayName: s.displayName,
              avatarUrl: s.avatarUrl,
            }))}
          />
        </div>
      </div>
    </PlatformShell>
  );
}
