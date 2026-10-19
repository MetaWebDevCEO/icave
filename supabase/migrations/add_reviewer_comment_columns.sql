-- Retroalimentación del revisor sobre cada asignación (comentario al supervisor)
alter table public.asignaciones
  add column if not exists reviewer_comment text,
  add column if not exists reviewer_comment_at timestamptz;
