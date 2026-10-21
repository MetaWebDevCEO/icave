import { PlatformShell } from "@/app/platform/platform-shell";
import { PlannerView, type PlannerAssignment } from "./planner-view";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { redirect } from "next/navigation";
import {
  buildSections,
  getRoleFromUserRolesTable,
  type UserRole,
} from "@/lib/platform-roles";

function isSchemaMismatch(error: unknown) {
  if (!error) return false;
  const message = (error as { message?: string }).message ?? "";
  return message.includes("column") && message.includes("does not exist");
}

async function fetchPlannerAssignments(role: UserRole, userEmail: string) {
  const selectFieldsExtended =
    "id, title, status, priority, created_at, due_at, submitted_at, completed_at, assigned_to_email, revisor_id";
  const selectFieldsMid =
    "id, title, status, priority, created_at, due_at, submitted_at, assigned_to_email, revisor_id";
  const selectFieldsBase =
    "id, title, status, priority, created_at, due_at, assigned_to_email, revisor_id";

  const isRevisor = role === "revisor";
  const client = isRevisor ? createServiceClient() : await createClient();

  const runQuery = async (fields: string) => {
    let query = client
      .from("asignaciones")
      .select(fields)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (!isRevisor) {
      query = query.ilike("assigned_to_email", userEmail);
    }

    const { data, error } = await query;
    if (error) {
      if (isSchemaMismatch(error)) throw new Error("schema_mismatch");
      return [];
    }

    return ((data ?? []) as unknown as PlannerAssignment[]).filter((row) => {
      if (isRevisor) return true;
      const owner = (row.assigned_to_email ?? "").trim().toLowerCase();
      return owner === userEmail;
    });
  };

  try {
    return await runQuery(selectFieldsExtended);
  } catch {
    try {
      return await runQuery(selectFieldsMid);
    } catch {
      return await runQuery(selectFieldsBase);
    }
  }
}

export default async function PlanificadorPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  let role: UserRole;
  try {
    role = await getRoleFromUserRolesTable(supabase, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    redirect("/?error=" + encodeURIComponent("Rol: " + message));
  }

  if (role !== "revisor" && role !== "usuario") {
    redirect("/platform");
  }

  const userEmail = (user.email ?? "").trim().toLowerCase();
  const sections = buildSections(role);
  const assignments = await fetchPlannerAssignments(role, userEmail);

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <PlannerView role={role} assignments={assignments} />
    </PlatformShell>
  );
}
