import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { SupervisoresCards } from "./supervisores-cards";
import {
  buildSections,
  resolveRoleForUser,
  normalizeRoleCode,
  type UserRole,
} from "@/lib/platform-roles";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function deriveDisplayName(email: string | null | undefined, metadata: Record<string, unknown>) {
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.display_name === "string"
        ? metadata.display_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";

  if (metadataName.trim()) return metadataName.trim();
  if (!email) return "Sin nombre";

  const localPart = email.split("@")[0] ?? "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deriveJobTitle(metadata: Record<string, unknown>): string {
  const candidates = [
    "job_title",
    "position",
    "puesto",
    "cargo",
    "role",
    "rol",
    "title",
    "titulo",
  ];
  for (const key of candidates) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Supervisor";
}

async function getSignedAvatarUrl(
  admin: {
    storage: {
      from: (
        bucket: string
      ) => {
        createSignedUrl: (
          path: string,
          expiresIn: number
        ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      };
    };
  },
  metadata: Record<string, unknown>
) {
  const bucket =
    typeof metadata.avatar_bucket === "string" && metadata.avatar_bucket.trim()
      ? metadata.avatar_bucket.trim()
      : "avatars";
  const path =
    typeof metadata.avatar_path === "string" && metadata.avatar_path.trim()
      ? metadata.avatar_path.trim()
      : "";

  if (!path) return null;

  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;

  return data.signedUrl;
}

export default async function SupervisoresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const role = await resolveRoleForUser(supabase, user.id);
  if (role !== "revisor") {
    redirect("/platform");
  }
  const sections = buildSections(role);

  if (!serviceKey || serviceKey.includes("__REPLACE_ME__")) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            Falta configurar SUPABASE_SERVICE_ROLE_KEY en .env.local para poder listar supervisores.
          </div>
        </div>
      </PlatformShell>
    );
  }

  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: usersData, error: usersError }, { data: rolesData }] =
    await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      admin.from("user_roles").select("user_id, role_code"),
    ]);

  if (usersError) {
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
            {usersError.message}
          </div>
        </div>
      </PlatformShell>
    );
  }

  const users = usersData?.users ?? [];
  const roles = (rolesData ?? []).map((row) => {
    const r = row as { user_id: unknown; role_code: unknown };
    return {
      userId: String(r.user_id),
      roleCode: typeof r.role_code === "string" ? r.role_code : null,
    };
  });

  const rolesMap = new Map<string, string | null>();
  roles.forEach((r) => rolesMap.set(r.userId, r.roleCode));

  const supervisores = [];
  for (const u of users) {
    const roleCode = rolesMap.get(u.id);
    const normalized = normalizeRoleCode(roleCode);
    if (normalized !== "usuario") continue;

    const metadata =
      u.user_metadata && typeof u.user_metadata === "object"
        ? (u.user_metadata as Record<string, unknown>)
        : {};

    supervisores.push({
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at ?? null,
      displayName: deriveDisplayName(u.email ?? null, metadata),
      jobTitle: deriveJobTitle(metadata),
      avatarUrl: await getSignedAvatarUrl(admin, metadata),
    });
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Supervisores</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {supervisores.length} resultados
          </div>
        </div>

        <SupervisoresCards supervisores={supervisores} />
      </div>
    </PlatformShell>
  );
}
