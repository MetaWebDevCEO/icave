import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const all = await admin.from("matriz").select("id, actividad, frecuencia").limit(1000);
const ids = (all.data ?? []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
const maxId = ids.length ? Math.max(...ids) : 0;
console.log("filas:", (all.data ?? []).length, "| maxId:", maxId);

console.log("\n--- prueba A: insert sin id ---");
const a = await admin
  .from("matriz")
  .insert([{ actividad: "__TMP_PROBE__", frecuencia: "" }])
  .select("id, actividad, frecuencia");
console.log("error:", a.error ? JSON.stringify(a.error) : "none");
console.log("data:", JSON.stringify(a.data));

if (a.data && a.data.length > 0) {
  const del = await admin.from("matriz").delete().eq("actividad", "__TMP_PROBE__").select("id");
  console.log("cleanup A:", del.error ? JSON.stringify(del.error) : "ok " + JSON.stringify(del.data));
} else {
  console.log("\n--- prueba B: insert con id explicito max+1 ---");
  const b = await admin
    .from("matriz")
    .insert([{ id: maxId + 1, actividad: "__TMP_PROBE__", frecuencia: "" }])
    .select("id, actividad");
  console.log("error:", b.error ? JSON.stringify(b.error) : "none");
  console.log("data:", JSON.stringify(b.data));
  if (b.data && b.data.length > 0) {
    const del = await admin.from("matriz").delete().eq("actividad", "__TMP_PROBE__").select("id");
    console.log("cleanup B:", del.error ? JSON.stringify(del.error) : "ok " + JSON.stringify(del.data));
  }
}

const final = await admin.from("matriz").select("id").limit(1000);
console.log("\nfila restantes tras limpieza:", final.data?.length ?? 0);
