import type { SupabaseClient } from "@supabase/supabase-js";

export type SubmissionFile = {
  path: string;
  name: string;
  mime?: string;
};

const MAX_EVIDENCE_FILES = 3;
const MAX_FILE_SIZE_BYTES = 10_000 * 1024;

export function maxEvidenceFiles() {
  return MAX_EVIDENCE_FILES;
}

export function maxSubmissionSizeBytes() {
  return MAX_FILE_SIZE_BYTES;
}

export function isPdfBytes(bytes: Uint8Array) {
  const header =
    String.fromCharCode(bytes[0] ?? 0) +
    String.fromCharCode(bytes[1] ?? 0) +
    String.fromCharCode(bytes[2] ?? 0) +
    String.fromCharCode(bytes[3] ?? 0);
  return header === "%PDF";
}

export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-()+\s]/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export const SUBMISSION_PATH_PREFIX = "entregas/";

export function isValidSubmissionPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const trimmed = path.trim().replace(/^\/+/, "");
  return trimmed.length > 0 && trimmed.startsWith(SUBMISSION_PATH_PREFIX);
}

export function parseSubmissionFiles(
  row:
    | {
        submission_files?: unknown;
        submission_path?: string | null;
        submission_name?: string | null;
        submission_mime?: string | null;
        description?: string | null;
      }
    | null
    | undefined
): SubmissionFile[] {
  const explicit = row?.submission_files;
  if (explicit) {
    if (Array.isArray(explicit)) {
      const arr = explicit as unknown[];
      const parsed: SubmissionFile[] = [];
      for (const it of arr) {
        if (it && typeof it === "object") {
          const obj = it as Record<string, unknown>;
          const rawPath = typeof obj.path === "string" ? obj.path : "";
          if (!isValidSubmissionPath(rawPath)) continue;
          const n =
            typeof obj.name === "string"
              ? obj.name
              : extractFileName(rawPath) ?? "evidencia.pdf";
          parsed.push({
            path: rawPath.trim().replace(/^\/+/, ""),
            name: n,
            mime: typeof obj.mime === "string" ? obj.mime : undefined,
          });
        }
      }
      if (parsed.length > 0) return parsed;
    }
    if (typeof explicit === "string") {
      try {
        const decoded = JSON.parse(explicit) as unknown;
        return parseSubmissionFiles({ submission_files: decoded });
      } catch {
        /* fallthrough */
      }
    }
  }

  const rawPath =
    (typeof row?.submission_path === "string" && row.submission_path.length > 0
      ? row.submission_path
      : extractLegacyEntregaPath(row?.description)) ?? null;

  if (!isValidSubmissionPath(rawPath)) return [];
  const path = rawPath.trim().replace(/^\/+/, "");

  const name =
    (typeof row?.submission_name === "string" && row.submission_name.length > 0
      ? row.submission_name
      : null) ?? extractFileName(path) ?? "evidencia.pdf";
  const mime =
    typeof row?.submission_mime === "string"
      ? row.submission_mime
      : "application/pdf";
  return [{ path, name, mime }];
}

export function extractFileName(path: string | null | undefined) {
  if (!path) return null;
  const lastSlash = path.lastIndexOf("/");
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  return name || null;
}

function extractLegacyEntregaPath(description: string | null | undefined) {
  if (!description) return null;
  const match = /^\s*entrega:\s*(\S+)\s*$/im.exec(description);
  return match?.[1] ?? null;
}

export function stripLegacyEntregaLines(description: string | null | undefined) {
  const input = String(description ?? "").trimEnd();
  const lines = input.length > 0 ? input.split(/\r?\n/) : [];
  const filtered = lines.filter((line) => {
    const normalized = line.trim().toLowerCase();
    if (normalized.startsWith("entrega:")) return false;
    if (normalized.startsWith("entregado por:")) return false;
    if (normalized.startsWith("entregado el:")) return false;
    if (normalized.startsWith("evidencia")) return false;
    return true;
  });
  return filtered.join("\n").trimEnd();
}

export function buildEvidenceDescription(
  baseDescription: string | null | undefined,
  files: SubmissionFile[],
  submittedByEmail: string,
  submittedAtISO: string
) {
  const cleaned = stripLegacyEntregaLines(baseDescription);
  const header = [
    "Enviado por: " + submittedByEmail,
    "Enviado el: " + submittedAtISO,
  ];
  const fileLines = files.map(
    (f, idx) => `Evidencia ${idx + 1}: ${f.path}`
  );
  const meta = [...header, ...fileLines].join("\n");
  return cleaned ? `${cleaned}\n\n${meta}` : meta;
}

export function getUpdatePayload(files: SubmissionFile[]) {
  const primary = files[0] ?? null;
  const primaryPath = primary?.path ?? null;
  const primaryName = primary?.name ?? null;

  return {
    full: {
      status: "Completada" as const,
      submission_files: files,
      submission_path: primaryPath,
      submission_name: primaryName,
      submission_mime: primary?.mime ?? "application/pdf",
    } as Record<string, unknown>,
    mid: {
      status: "Completada" as const,
      submission_path: primaryPath,
      submission_name: primaryName,
      submission_mime: primary?.mime ?? "application/pdf",
    } as Record<string, unknown>,
    fallback: {
      status: "Completada" as const,
    } as Record<string, unknown>,
  };
}

export function isSchemaMismatchPostgres(err: {
  code?: unknown;
  message?: string | null;
} | null) {
  if (!err) return false;
  const code = (err.code as string | undefined) ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return (
    code === "PGRST204" ||
    msg.includes("schema cache") ||
    msg.includes("could not find") ||
    msg.includes("does not exist") ||
    msg.includes("column")
  );
}

export async function cleanupFolder(
  client: SupabaseClient,
  bucket: string,
  folderPath: string
) {
  try {
    const listed = await client.storage.from(bucket).list(folderPath, {
      limit: 50,
      offset: 0,
    });
    if (listed.data && listed.data.length > 0) {
      const pdfsToRemove = listed.data
        .filter((f) => f.name.toLowerCase().endsWith(".pdf"))
        .map((f) => `${folderPath}/${f.name}`);
      if (pdfsToRemove.length > 0) {
        await client.storage
          .from(bucket)
          .remove(pdfsToRemove)
          .catch(() => null);
      }
    }
  } catch {
    /* ignore cleanup errors */
  }
}

export async function listEvidenceInFolder(
  client: SupabaseClient,
  bucket: string,
  folderPath: string
): Promise<SubmissionFile[]> {
  const listed = await client.storage.from(bucket).list(folderPath, {
    limit: 20,
    offset: 0,
  });
  if (listed.error || !listed.data || listed.data.length === 0) return [];
  const pdfs = listed.data
    .filter((f) => f.name.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  return pdfs.map((f) => ({
    path: `${folderPath}/${f.name}`,
    name: f.name,
    mime: "application/pdf",
  }));
}
