import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  resolveRoleForUser,
  buildSections,
  type UserRole,
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

function isSchemaMismatch(err: PostgrestError | null) {
  if (!err) return false;
  return isSchemaMismatchPostgres(err);
}

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_SIGNED_URL_EXPIRES_SECONDS = 60 * 10;

// ------------------------------------------------------------------
// Helpers usados POR las funciones de caché.
// Importante: NO reciben `SupabaseClient` como argumento, porque
// `unstable_cache` requiere argumentos serializables (strings).
// ------------------------------------------------------------------

function buildSupabase(url: string, key: string): SupabaseClient | null {
  if (!url || !key) return null;
  return createSupabaseAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ===================== CACHÉ GLOBAL (solo args serializables) =====================

/** Matriz de 64 actividades. Caché 10 minutos. */
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
      if (!isSchemaMismatch(extended.error)) {
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
      if (!existing || (actividad.length > 0 && existing.actividad.length === 0)) {
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
  ["asignacion-matriz-64"],
  { revalidate: 60 * 10, tags: ["matriz"] }
);

/** Roles y userIds de supervisores. Caché 5 minutos. */
const getCachedSupervisorUserIds = unstable_cache(
  async (
    sbUrl: string,
    anonKey: string,
    serviceKey: string
  ): Promise<{
    supervisorIds: string[];
    revisorIds: string[];
  }> => {
    const admin = buildSupabase(sbUrl, serviceKey);
    const anon = buildSupabase(sbUrl, anonKey);
    const client: SupabaseClient | null = admin ?? anon;
    if (!client) return { supervisorIds: [], revisorIds: [] };

    const SELECT_ROLES_EXT =
      "id, created_at, user_id, role, rol, user_role, tipo, type, role_code";
    const SELECT_ROLES_BASE = "user_id, role";

    let rolesData: {
      user_id?: unknown;
      role?: unknown;
      rol?: unknown;
      user_role?: unknown;
      tipo?: unknown;
      type?: unknown;
      role_code?: unknown;
    }[] = [];
    try {
      const ext = await client
        .from("user_roles")
        .select(SELECT_ROLES_EXT)
        .limit(500);
      if (!isSchemaMismatch(ext.error)) {
        rolesData = (ext.data ?? []) as typeof rolesData;
      } else {
        const base = await client
          .from("user_roles")
          .select(SELECT_ROLES_BASE)
          .limit(500);
        rolesData = (base.data ?? []) as typeof rolesData;
      }
    } catch {
      rolesData = [];
    }

    const normalizeRole = (
      record: (typeof rolesData)[number]
    ): string | null => {
      const candidates = [
        record.role,
        record.rol,
        record.user_role,
        record.tipo,
        record.type,
        record.role_code,
      ];
      for (const c of candidates) {
        if (typeof c !== "string") continue;
        const v = c.trim().toLowerCase();
        if (v.length === 0) continue;
        if (
          v === "usuario" ||
          v === "supervisor" ||
          v === "sup" ||
          v === "s" ||
          v === "admin" ||
          v === "administrador" ||
          v === "2"
        )
          return "usuario";
        if (
          v === "revisor" ||
          v === "reviewer" ||
          v === "rev" ||
          v === "r" ||
          v === "1"
        )
          return "revisor";
      }
      return null;
    };

    const supervisorIds: string[] = [];
    const revisorIds: string[] = [];
    for (const r of rolesData) {
      const uid = typeof r.user_id === "string" ? r.user_id.trim() : "";
      if (!uid) continue;
      const rl = normalizeRole(r);
      if (rl === "usuario") supervisorIds.push(uid);
      if (rl === "revisor") revisorIds.push(uid);
    }
    return { supervisorIds, revisorIds };
  },
  ["asignacion-supervisor-ids"],
  { revalidate: 60 * 5, tags: ["supervisores"] }
);

/** Lista de usuarios via `auth.admin.listUsers`. Caché 5 minutos. */
const getCachedAuthUsers = unstable_cache(
  async (
    sbUrl: string,
    _anonKey: string,
    serviceKey: string
  ): Promise<{
    allUsers: {
      id: string;
      email: string | null;
      displayName: string;
      avatarBucket: string;
      avatarPath: string;
      fallbackAvatar: string | null;
    }[];
  }> => {
    type AuthUserBasic = {
      id: string;
      email: string | null;
      displayName: string;
      avatarBucket: string;
      avatarPath: string;
      fallbackAvatar: string | null;
    };
    const allUsers: AuthUserBasic[] = [];
    const admin = buildSupabase(sbUrl, serviceKey);
    if (!admin) return { allUsers };

    try {
      const listed = await (admin.auth as unknown as {
        admin: {
          listUsers: (args: {
            page: number;
            perPage: number;
          }) => Promise<{ data?: { users?: Array<unknown> } | null }>;
        };
      }).admin.listUsers({ page: 1, perPage: 500 });
      const users = ((listed.data?.users ?? []) as Array<{
        id: string;
        email?: string | null;
        user_metadata?: {
          full_name?: string;
          name?: string;
          avatar_bucket?: string;
          avatar_path?: string;
          avatar_url?: string;
          picture?: string;
        } | null;
      }>) || [];

      for (const u of users) {
        const rawName =
          u.user_metadata?.full_name || u.user_metadata?.name || "";
        const displayName =
          (typeof rawName === "string" ? rawName.trim() : "") ||
          (u.email ? u.email.split("@")[0] : "");
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
          displayName,
          avatarBucket: bucket || DEFAULT_AVATAR_BUCKET,
          avatarPath: path,
          fallbackAvatar: fallbackPicture ?? null,
        });
      }
    } catch {
      /* ignore */
    }
    return { allUsers };
  },
  ["asignacion-auth-users"],
  { revalidate: 60 * 5, tags: ["auth-users"] }
);

/** Signed URL de avatar por usuario. Caché 8 horas. */
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
  ["asignacion-avatar-signed"],
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
    redirect(
      "/?error=" + encodeURIComponent("Configura Supabase primero (env vars).")
    );
  }

  const supabase = await createClient();
  const authResp = await supabase.auth.getUser();
  const user = authResp.data?.user ?? null;
  const error = authResp.error;
  if (error || !user) redirect("/auth/login");

  // -- En PARALELO: sidebar (secciones) + 3 caches pesados --
  const [
    sections,
    matrizRes,
    rolesRes,
    authUsersRes,
  ] = await Promise.all([
    (async (): Promise<SidebarSection[]> => {
      try {
        const role: UserRole = await resolveRoleForUser(supabase, user.id);
        return buildSections(role);
      } catch {
        return buildSections("revisor");
      }
    })(),
    getCachedMatriz(url, anonKey, serviceKey),
    getCachedSupervisorUserIds(url, anonKey, serviceKey),
    getCachedAuthUsers(url, anonKey, serviceKey),
  ]);

  const { matrizOptions } = matrizRes;
  const { supervisorIds, revisorIds: revisorIdsFromRoles } = rolesRes;
  const { allUsers } = authUsersRes;

  // ---- Supervisores final list ----
  type SupervisorOption = {
    id: string;
    email: string | null;
    displayName: string;
    avatarUrl: string | null;
    avatarBucket: string;
    avatarPath: string;
    fallbackAvatar: string | null;
  };

  const supervisores: SupervisorOption[] = [];
  const seenUserIds = new Set<string>();

  if (supervisorIds.length > 0) {
    for (const uid of supervisorIds) {
      const found = allUsers.find((u) => u.id === uid);
      if (found) {
        supervisores.push({
          id: found.id,
          email: found.email,
          displayName: found.displayName,
          avatarUrl: null,
          avatarBucket: found.avatarBucket,
          avatarPath: found.avatarPath,
          fallbackAvatar: found.fallbackAvatar,
        });
        seenUserIds.add(found.id);
      } else {
        supervisores.push({
          id: uid,
          email: null,
          displayName: `Supervisor ${uid.slice(0, 6)}`,
          avatarUrl: null,
          avatarBucket: DEFAULT_AVATAR_BUCKET,
          avatarPath: "",
          fallbackAvatar: null,
        });
        seenUserIds.add(uid);
      }
    }
  }

  if (supervisores.length === 0 && allUsers.length > 0) {
    const revisorIdsSet = new Set<string>(revisorIdsFromRoles);
    for (const u of allUsers) {
      if (u.id === user.id) continue;
      if (revisorIdsSet.has(u.id)) continue;
      if (seenUserIds.has(u.id)) continue;
      supervisores.push({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: null,
        avatarBucket: u.avatarBucket,
        avatarPath: u.avatarPath,
        fallbackAvatar: u.fallbackAvatar,
      });
      seenUserIds.add(u.id);
    }
  }

  supervisores.sort((a, b) => {
    const an = a.displayName.toLowerCase();
    const bn = b.displayName.toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });

  // ---- Avatares con caché 8h ----
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
  const revisorAvatarUrl = safeResult(0);
  for (let i = 0; i < supervisores.length; i++) {
    supervisores[i].avatarUrl = safeResult(i + 1);
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto h-[calc(100dvh-4rem)] w-full max-w-[1400px] px-0 md:px-0">
        <AsignacionForm
          currentUserId={user.id}
          currentUserEmail={user.email}
          currentUserAvatarUrl={revisorAvatarUrl}
          matrizOptions={matrizOptions}
          supervisores={supervisores}
        />
      </div>
    </PlatformShell>
  );
}
