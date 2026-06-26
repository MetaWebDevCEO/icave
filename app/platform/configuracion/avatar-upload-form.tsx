"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

function UploadBadge() {
  const { pending } = useFormStatus();

  return (
    <span className="absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white bg-[#003373] text-white shadow-[0_10px_24px_rgba(0,51,115,0.24)] dark:border-zinc-950">
      {pending ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <path
            d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M13.5 7l3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

export function AvatarUploadForm({
  action,
  avatarUrl,
  displayName,
  avatarFallback,
}: {
  action: (formData: FormData) => void | Promise<void>;
  avatarUrl: string | null;
  displayName: string;
  avatarFallback: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="mt-6 flex items-center gap-4">
      <div className="relative">
        <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_30%,#D9E7FF_0%,#82A6E8_42%,#003373_100%)] text-base font-semibold text-white shadow-sm ring-4 ring-[#EAF0FB] dark:ring-zinc-900">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={`Avatar de ${displayName}`}
              className="h-full w-full object-cover"
            />
          ) : (
            avatarFallback
          )}
        </div>
        <label className="absolute inset-0 cursor-pointer rounded-full" aria-label="Actualizar avatar">
          <input
            type="file"
            name="avatar"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              if (event.currentTarget.files?.length) {
                formRef.current?.requestSubmit();
              }
            }}
          />
        </label>
        <UploadBadge />
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          Foto de perfil
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Selecciona una imagen JPG, PNG o WEBP de hasta 2 MB. Se sube automaticamente.
        </div>
      </div>
    </form>
  );
}
