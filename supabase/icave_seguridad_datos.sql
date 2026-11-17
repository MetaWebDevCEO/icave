-- ============================================================
-- ICAVE - Datos de catálogos para el módulo de seguridad
-- Inserta los valores de las listas desplegables
-- ============================================================

-- Tipos de lesionado
insert into public.lesionado_tipo (nombre, orden) values
  ('Trabajador Permanente', 1),
  ('Trabajador Sindicalizado', 2),
  ('Controlador Eventual', 3),
  ('Trabajador Contratista o proveedor', 4),
  ('Empleado Aduanal', 5),
  ('Operador de SPF', 6),
  ('Autoridad (Aduana, ASIPONA)', 7),
  ('Visitante', 8),
  ('Otro', 99)
on conflict (nombre) do nothing;

-- Tipos de incidente personal
insert into public.incidente_personal_tipo (nombre, orden) values
  ('Trabajador Incapacitante IMSS', 1),
  ('Incapacitante SMI', 2),
  ('No Incapacitante (Primeros Auxilios)', 3)
on conflict (nombre) do nothing;

-- Equipos involucrados
insert into public.equipo_involucrado (nombre, orden) values
  ('Grúa Pórtico', 1),
  ('Grúa RTG', 2),
  ('Equipo Autónomo (AT)', 3),
  ('Equipo A', 4),
  ('Equipo B', 5),
  ('Tractoplana', 6),
  ('Montacarga', 7),
  ('SPF', 8),
  ('Equipo / Vehículo Contratista', 9),
  ('Vehículo Particular', 10),
  ('Vehículo Autoridades', 11),
  ('Otro', 99)
on conflict (nombre) do nothing;

-- Tipos de emergencia
insert into public.emergencia_tipo (nombre, orden) values
  ('Conato de Incendio', 1),
  ('Atención a Derrame', 2),
  ('Sismo', 3),
  ('Rescate Acuático', 4),
  ('Traslado de Lesionado', 5),
  ('Traslado por Enfermedad General', 6)
on conflict (nombre) do nothing;

-- Tipos de derrame
insert into public.derrame_tipo (nombre, orden) values
  ('Equipo Portuario', 1),
  ('Contenedor (Mercancía)', 2),
  ('Otro', 99)
on conflict (nombre) do nothing;

-- Clases IMO
insert into public.imo_clase (nombre, orden) values
  ('IMO clase 3', 1),
  ('IMO clase 4.1', 2),
  ('IMO clase 4.2', 3),
  ('IMO clase 4.3', 4),
  ('IMO clase 5.1', 5),
  ('IMO clase 5.2', 6),
  ('IMO clase 6.1', 7),
  ('IMO clase 8', 8)
on conflict (nombre) do nothing;

-- Tipos de equipo portuario (derrames)
insert into public.equipo_portuario_tipo (nombre, orden) values
  ('Tractoplana', 1),
  ('Montacargas', 2),
  ('Equipo A', 3),
  ('Equipo B', 4),
  ('Grúa RTG', 5),
  ('Grúa Pórtico', 6),
  ('Equipo Autónomo (AT)', 7)
on conflict (nombre) do nothing;

-- Tipos de actos inseguros
insert into public.acto_inseguro_tipo (nombre, orden) values
  ('Trabajador Permanente', 1),
  ('Trabajador Sindicalizado', 2),
  ('Controlador Eventual', 3),
  ('Trabajador Contratista o proveedor', 4),
  ('Empleado Aduanal', 5),
  ('Operador de SPF', 6),
  ('Autoridad (Aduana, ASIPONA)', 7),
  ('Visitante', 8),
  ('Otro', 99)
on conflict (nombre) do nothing;

-- Tipos de condición insegura
insert into public.condicion_insegura_tipo (nombre, orden) values
  ('Infraestructura', 1),
  ('Equipo Portuario', 2),
  ('Materiales y equipos contratistas', 3),
  ('Buque', 4),
  ('Contenedor', 5),
  ('Camión de SPF', 6),
  ('Otro', 99)
on conflict (nombre) do nothing;

-- Actividades referentes al clima
insert into public.actividad_clima_tipo (nombre, orden) values
  ('Supervisión de anclaje de gruas QC', 1),
  ('Validar funcionamiento de anemómetro', 2),
  ('Revisión del Check List para Nortes', 3),
  ('Envío de Boletín', 4),
  ('Monitoreo de la velocidad del viento', 5),
  ('Envío de Gráfica de viento', 6),
  ('Otra', 99)
on conflict (nombre) do nothing;

-- Tipos de reporte de riesgo
insert into public.reporte_riesgo_tipo (nombre, orden) values
  ('Casi incidente', 1),
  ('Situación Potencial de Riesgo', 2),
  ('Análisis de Riesgo de Actividad', 3)
on conflict (nombre) do nothing;

-- Tipos de capacitación
insert into public.capacitacion_tipo (nombre, orden) values
  ('Inducción a contratistas', 1),
  ('Inducción a SOS', 2),
  ('Combate contra incendio', 3),
  ('Manejo Defensivo', 4),
  ('Curso Mercancías Peligrosas', 5),
  ('Vigilancia en Patio', 6),
  ('Pruebas Física', 7),
  ('Reglamento de Seguridad', 8),
  ('Prueba de Vértigo', 9),
  ('Prueba de Fuerza', 10),
  ('Otro', 99)
on conflict (nombre) do nothing;

-- Tipos de capacitación a brigadas
insert into public.capacitacion_brigada_tipo (nombre, orden) values
  ('Capacitación Contraincendios', 1),
  ('Capacitación Rescate Acuático', 2),
  ('Capacitación de Rescate en alturas', 3)
on conflict (nombre) do nothing;
