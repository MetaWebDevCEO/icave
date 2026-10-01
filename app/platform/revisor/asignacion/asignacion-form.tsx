"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import {
  X,
  FileText,
  Upload,
  CalendarDays,
  Flag,
  Percent,
  ClipboardCheck,
  Trash,
  Pencil,
  CheckCircle,
} from "@/components/ui/icons";
import {
  createAssignment,
  type AttachmentFileInput,
  type CreateAssignmentResult,
} from "./actions"

type MatrizOption = { id: number; actividad: string }
type SupervisorOption = {
  id: string
  email: string | null
  displayName: string
  avatarUrl: string | null
  userId?: string
}

const SUPERVISOR_EMAIL_NULL_PREFIX = "__NO_EMAIL__:"

function supervisorToValue(s: SupervisorOption | undefined | null): string {
  if (!s) return ""
  if (s.email) return s.email
  return `${SUPERVISOR_EMAIL_NULL_PREFIX}${s.id}`
}

function parseSupervisorValue(
  v: string,
  supervisores: SupervisorOption[]
): SupervisorOption | undefined {
  if (!v) return undefined
  // 1. Match por email (caso normal)
  const byEmail = supervisores.find((s) => s.email && s.email === v)
  if (byEmail) return byEmail
  // 2. Match por formato __NO_EMAIL__:<id> (cuando el usuario no tiene email en auth.users)
  if (v.startsWith(SUPERVISOR_EMAIL_NULL_PREFIX)) {
    const id = v.slice(SUPERVISOR_EMAIL_NULL_PREFIX.length)
    return supervisores.find((s) => s.id === id)
  }
  // 3. Fallback: si por alguna razón mandan un email/valor crudo que no matchea,
  //    buscan por email case-insensitive o substring.
  const lower = v.trim().toLowerCase()
  return supervisores.find(
    (s) => s.email && s.email.trim().toLowerCase() === lower
  )
}

export interface AsignacionFormProps {
  currentUserId: string
  currentUserEmail: string | undefined
  currentUserAvatarUrl?: string | null
  matrizOptions: MatrizOption[]
  supervisores: SupervisorOption[]
}

type UploadedFile = {
  id: string
  name: string
  size: number
  file?: File
}

const MAX_FILES = 3
const MAX_FILE_SIZE = 10 * 1024 * 1024

export function AsignacionForm(props: AsignacionFormProps) {
  const { currentUserId, currentUserEmail, currentUserAvatarUrl, matrizOptions, supervisores } = props
  const [actividadId, setActividadId] = React.useState<string>("")
  const [descripcion, setDescripcion] = React.useState("")
  const [files, setFiles] = React.useState<UploadedFile[]>([])
  const [supervisorValue, setSupervisorValue] = React.useState<string>("")
  const [isEditingSupervisor, setIsEditingSupervisor] = React.useState<boolean>(true)
  const [publicacionDate, setPublicacionDate] = React.useState<Date | null>(new Date())
  const [entregaDate, setEntregaDate] = React.useState<Date | null>(null)
  const [prioridad, setPrioridad] = React.useState<"alto" | "medio" | "bajo">("medio")
  const cumplimiento = 0
  const estado = "Pendiente"

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitResult, setSubmitResult] = React.useState<CreateAssignmentResult | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    const newFiles: UploadedFile[] = []
    const remaining = MAX_FILES - files.length
    for (let i = 0; i < Math.min(fileList.length, remaining); i++) {
      const f = fileList[i]
      if (f.type !== "application/pdf") continue
      if (f.size > MAX_FILE_SIZE) continue
      newFiles.push({
        id: Math.random().toString(36).slice(2, 10),
        name: f.name,
        size: f.size,
        file: f,
      })
    }
    setFiles((prev) => [...prev, ...newFiles].slice(0, MAX_FILES))
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const clearForm = () => {
    setActividadId("")
    setDescripcion("")
    setFiles([])
    setSupervisorValue("")
    setIsEditingSupervisor(true)
    setPublicacionDate(new Date())
    setEntregaDate(null)
    setPrioridad("medio")
    setSubmitResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function toISOAtMidnight(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}T00:00:00.000Z`
  }

  async function handleCrearAsignacion() {
    setSubmitResult(null)
    if (!actividadSeleccionada) {
      setSubmitResult({ ok: false, error: "Selecciona una actividad de la matriz." })
      return
    }
    if (!supervisorFinalEmail) {
      setSubmitResult({ ok: false, error: "Selecciona un supervisor a quién asignar la tarea." })
      return
    }
    if (!entregaDate) {
      setSubmitResult({ ok: false, error: "Selecciona fecha límite de entrega." })
      return
    }
    try {
      setSubmitting(true)
      const pdfs: AttachmentFileInput[] = []
      for (const f of files) {
        if (!f.file) continue
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error("PDF no legible"))
          reader.onload = () => {
            const r = reader.result as string
            const idx = r.indexOf(",")
            resolve(idx >= 0 ? r.slice(idx + 1) : r)
          }
          reader.readAsDataURL(f.file as unknown as Blob)
        })
        pdfs.push({
          name: f.name,
          type: (f.file.type || "application/pdf") as string,
          base64,
        })
      }

      const result = await createAssignment({
        actividadTitulo: actividadSeleccionada.actividad,
        descripcion,
        supervisorEmail: supervisorFinalEmail,
        supervisorName: supervisorFinalName,
        revisorEmail: currentUserEmail ?? "",
        revisorUserId: currentUserId,
        fechaEntregaLimiteISO: toISOAtMidnight(entregaDate),
        prioridad,
        status: estado.toLowerCase(),
        attachmentFiles: pdfs,
      })
      setSubmitResult(result)

      if (result.ok) {
        setActividadId("")
        setDescripcion("")
        setFiles([])
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    } catch (err) {
      setSubmitResult({
        ok: false,
        error:
          err instanceof Error
            ? `Error al crear la asignación: ${err.message}`
            : "Error desconocido al crear la asignación.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const actividadSeleccionada = matrizOptions.find(
    (m) => String(m.id) === actividadId
  )
  const supervisorSeleccionado = parseSupervisorValue(supervisorValue, supervisores)

  const supervisorFinalEmail: string | null = supervisorSeleccionado?.email ?? null
  const supervisorFinalName: string =
    supervisorSeleccionado?.displayName ||
    supervisorSeleccionado?.email?.split("@")[0] ||
    "Supervisor"
  const supervisorFinalAvatarUrl: string | null =
    supervisorSeleccionado?.avatarUrl ?? null

  const prioridadVariant =
    prioridad === "alto"
      ? "destructive"
      : prioridad === "medio"
      ? "warning"
      : "success"

  return (
    <div className="flex w-full flex-col gap-4">
      {/* HEADER */}
      <div className="pt-1">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Asignación de Tareas
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Crea y asigna actividades del plan de trabajo a los supervisores.
        </p>
      </div>

      {/* FORMULARIO - DOS COLUMNAS */}
      <div className="w-full">
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-5">
          {/* COLUMNA IZQUIERDA */}
          <Card className="flex flex-col lg:col-span-3 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-[#023674] dark:text-[#6bb4ff]" />
                Detalle de la Tarea
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {/* Selector de tareas (actividad) */}
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Actividad (Matriz)
                </Label>
                <Select value={actividadId} onValueChange={setActividadId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una actividad de la matriz…">
                      {actividadSeleccionada?.actividad ? (
                        <span className="block w-full truncate text-left text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {actividadSeleccionada.actividad}
                        </span>
                      ) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {matrizOptions.length === 0 ? (
                      <div className="px-2 py-4 text-center text-sm text-zinc-500">
                        No hay actividades disponibles en la matriz.
                      </div>
                    ) : (
                      matrizOptions.map((m) => (
                        <SelectItem
                          key={m.id}
                          value={String(m.id)}
                        >
                          <span className="block w-full truncate">
                            {m.actividad || `Actividad ${m.id}`}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Descripción */}
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Descripción de la tarea
                </Label>
                <Textarea
                  placeholder="Añade instrucciones, contexto, referencias o notas adicionales para el supervisor…"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  className="h-40 resize-none text-sm leading-relaxed"
                />
              </div>

              {/* Subida de PDFs */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Documentos adjuntos (PDF)
                  </Label>
                  <span
                    className={cn(
                      "text-[11px]",
                      files.length >= MAX_FILES
                        ? "text-amber-600 dark:text-amber-500"
                        : "text-zinc-500 dark:text-zinc-400"
                    )}
                  >
                    {files.length}/{MAX_FILES} archivos
                  </span>
                </div>

                {/* [Visible solo cuando NO hay archivos] */}
                {files.length === 0 ? (
                  <div
                    className="rounded-lg border border-dashed border-zinc-300 px-4 py-5 transition-colors hover:border-[#023674]/40 hover:bg-[#023674]/[0.02] dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-2 text-center"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div className="text-xs">
                        <span className="font-medium text-[#023674] dark:text-[#6bb4ff]">
                          Haz clic para subir
                        </span>
                        <span className="text-zinc-500 dark:text-zinc-400">
                          {" "}
                          o arrastra los archivos aquí
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        PDF • Máx. {MAX_FILES} archivos • ≤ 10 MB cada uno
                      </div>
                    </button>
                  </div>
                ) : null}

                {/* Lista de archivos subidos + botón compacto "Añadir otro" */}
                {files.length > 0 && (
                  <div className="space-y-2.5">
                    <ul className="space-y-2">
                      {files.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#023674]/10 text-[#023674] dark:bg-[#6bb4ff]/10 dark:text-[#6bb4ff]">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                              {f.name}
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {(f.size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(f.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            aria-label="Eliminar archivo"
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>

                    {/* Botón compacto añadir (solo si queda espacio) */}
                    {files.length < MAX_FILES ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:border-[#023674]/40 hover:bg-[#023674]/[0.02] hover:text-[#023674] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:text-[#6bb4ff]"
                      >
                        <span className="flex items-center gap-1.5">
                          <Upload className="h-3.5 w-3.5" />
                          Añadir otro PDF
                        </span>
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                          {files.length}/{MAX_FILES}
                        </span>
                      </button>
                    ) : (
                      <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                        Límite de {MAX_FILES} archivos alcanzado. Elimina uno para
                        añadir otro.
                      </p>
                    )}
                  </div>
                )}

                {/* Input oculto (siempre presente para poder activarlo desde cualquier botón) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  disabled={files.length >= MAX_FILES}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </CardContent>
          </Card>

          {/* COLUMNA DERECHA */}
          <Card className="flex flex-col lg:col-span-2 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-5 w-5 text-[#023674] dark:text-[#6bb4ff]" />
                Asignación y Seguimiento
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {/* Revisor (solo lectura) */}
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Revisor
                </Label>
                <div className="flex h-11 items-center gap-2.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
                  <Avatar
                    src={currentUserAvatarUrl}
                    alt={currentUserEmail || "Revisor"}
                    initials={currentUserEmail}
                    className="h-8 w-8 text-[11px]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {currentUserEmail || "Usuario actual"}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Asignación creada por el revisor en sesión
                    </div>
                  </div>
                </div>
              </div>

              {/* Supervisor (selector) */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Supervisor asignado
                  </Label>
                  {supervisorFinalEmail && !isEditingSupervisor ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingSupervisor(true)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-[#023674] transition-colors hover:bg-[#023674]/10 dark:text-[#02A9E5] dark:hover:bg-[#02A9E5]/10"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Cambiar
                    </button>
                  ) : null}
                </div>

                {!supervisorFinalEmail || isEditingSupervisor ? (
                  <div className="space-y-2">
                    <Select
                      value={supervisorValue}
                      onValueChange={(v) => {
                        setSupervisorValue(v)
                        if (v) setIsEditingSupervisor(false)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un supervisor…">
                          {supervisorSeleccionado ? (
                            <div className="flex w-full min-w-0 items-center gap-2">
                              <Avatar
                                src={supervisorSeleccionado.avatarUrl}
                                alt={
                                  supervisorSeleccionado.email ||
                                  supervisorSeleccionado.displayName
                                }
                                initials={
                                  supervisorSeleccionado.displayName ||
                                  supervisorSeleccionado.email ||
                                  undefined
                                }
                                className="h-6 w-6 text-[10px]"
                              />
                              <span className="truncate">
                                {supervisorSeleccionado.email ||
                                  supervisorSeleccionado.displayName}
                              </span>
                            </div>
                          ) : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {supervisores.length === 0 ? (
                          <div className="px-2 py-4 text-center text-sm text-zinc-500">
                            No hay supervisores registrados.
                          </div>
                        ) : (
                          supervisores.map((s) => (
                            <SelectItem
                              key={s.id}
                              value={supervisorToValue(s)}
                            >
                              <div className="flex w-full min-w-0 items-center gap-2">
                                <Avatar
                                  src={s.avatarUrl}
                                  alt={s.email || s.displayName}
                                  initials={
                                    s.displayName || s.email || undefined
                                  }
                                  className="h-6 w-6 text-[10px]"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                    {s.email || s.displayName || "Sin correo"}
                                  </div>
                                  {s.displayName &&
                                  s.email &&
                                  s.displayName !== s.email ? (
                                    <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                      {s.displayName}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {isEditingSupervisor && supervisorSeleccionado ? (
                      <button
                        type="button"
                        onClick={() => setIsEditingSupervisor(false)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Mantener seleccionado
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Tarjeta del supervisor (visible cuando hay seleccion y no estamos editando) */}
                {supervisorFinalEmail && !isEditingSupervisor ? (
                  <div className="mt-1.5 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <Avatar
                      src={supervisorFinalAvatarUrl}
                      alt={supervisorFinalEmail}
                      initials={supervisorFinalName || supervisorFinalEmail}
                      className="h-9 w-9 text-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        {supervisorFinalName || "Supervisor"}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {supervisorFinalEmail}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSupervisorValue("")
                        setIsEditingSupervisor(true)
                      }}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      aria-label="Quitar supervisor"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Fechas: Publicación -> Entrega (rango) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Fecha límite
                  </Label>
                  <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                    Publicación → Entrega
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <DatePicker
                    value={publicacionDate}
                    onChange={setPublicacionDate}
                    placeholder="dd/mm/aaaa"
                    label="Publicación"
                    hint="Fecha en que se notifica la tarea"
                  />
                  <DatePicker
                    value={entregaDate}
                    onChange={setEntregaDate}
                    placeholder="dd/mm/aaaa"
                    label="Entrega límite"
                    hint="Último día para cumplimentar"
                  />
                </div>
                {publicacionDate && entregaDate ? (
                  <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-gradient-to-r from-[#023674]/5 via-white to-white px-3 py-2.5 dark:border-zinc-800 dark:from-[#02A9E5]/5 dark:via-zinc-950 dark:to-zinc-950">
                    <div className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <CalendarDays className="h-3.5 w-3.5 text-[#023674] dark:text-[#02A9E5]" />
                      <span>Plazo total de entrega</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-[#023674]/10 px-2 py-0.5 text-[11px] font-semibold text-[#023674] dark:bg-[#02A9E5]/10 dark:text-[#02A9E5]">
                        {Math.max(
                          1,
                          Math.ceil(
                            (entregaDate.getTime() - publicacionDate.getTime()) /
                              (1000 * 60 * 60 * 24)
                          )
                        )}{" "}
                        días
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {publicacionDate
                        ? "Selecciona una fecha de entrega límite."
                        : "Selecciona fecha de publicación y de entrega."}
                    </span>
                  </div>
                )}
              </div>

              {/* Prioridad */}
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Prioridad
                </Label>
                <Select
                  value={prioridad}
                  onValueChange={(v) =>
                    setPrioridad(v as "alto" | "medio" | "bajo")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alto">
                      <div className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                        Alto
                      </div>
                    </SelectItem>
                    <SelectItem value="medio">
                      <div className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        Medio
                      </div>
                    </SelectItem>
                    <SelectItem value="bajo">
                      <div className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Bajo
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="mt-2">
                  <Badge
                    variant={
                      prioridadVariant as
                        | "default"
                        | "secondary"
                        | "destructive"
                        | "outline"
                        | "success"
                        | "warning"
                    }
                    className="uppercase tracking-wide"
                  >
                    <Flag className="h-3 w-3 mr-1" />
                    Prioridad {prioridad}
                  </Badge>
                </div>
              </div>

              {/* Cumplimiento */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Cumplimiento
                  </Label>
                  <div className="flex items-center gap-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    <Percent className="h-3.5 w-3.5 text-zinc-500" />
                    {cumplimiento}%
                  </div>
                </div>
                <Progress value={cumplimiento} className="h-2" />
                <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  El cumplimiento inicia en 0% y se actualiza con las entregas del
                  supervisor.
                </p>
              </div>

              {/* Estado */}
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Estado
                </Label>
                <div className="flex h-9 items-center gap-2.5 rounded-md border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <span className="inline-flex h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-500/20" />
                  <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    {estado}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">
                    Estado inicial al crear la tarea
                  </span>
                </div>
              </div>

              {/* Feedback del submit */}
              {submitResult && (
                <div
                  role="status"
                  className={cn(
                    "rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
                    submitResult.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                  )}
                >
                  {submitResult.ok ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Tarea creada correctamente
                      </div>
                      <div>
                        ID:{" "}
                        <span className="font-mono text-[11px]">
                          {submitResult.id}
                        </span>
                      </div>
                      <div className="text-[11.5px] opacity-95">
                        {submitResult.emailQueued
                          ? "Correo de notificación en proceso (llega en segundos)."
                          : submitResult.emailSent
                          ? "Correo de notificación enviado al supervisor."
                          : `Tarea guardada, pero no se pudo enviar el correo: ${
                              submitResult.emailError ?? "Error desconocido"
                            }`}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="font-semibold">No se pudo crear la tarea</div>
                      <div className="mt-0.5 opacity-95">{submitResult.error}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Botones de acción */}
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  onClick={handleCrearAsignacion}
                  disabled={submitting}
                  className="w-full gap-1.5 bg-[#023674] hover:bg-[#063f85] disabled:cursor-not-allowed disabled:opacity-60"
                  size="lg"
                >
                  {submitting ? (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4 animate-spin"
                        fill="none"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="3"
                          className="opacity-25"
                        />
                        <path
                          d="M22 12a10 10 0 0 1-10 10"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      Creando y notificando…
                    </>
                  ) : (
                    <>
                      <ClipboardCheck className="h-4 w-4" />
                      Crear Asignación
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={clearForm}
                  disabled={submitting}
                  className="w-full gap-1.5 disabled:opacity-50"
                  size="lg"
                >
                  <X className="h-4 w-4" />
                  Limpiar formulario
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default AsignacionForm
