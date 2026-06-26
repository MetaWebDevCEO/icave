type PrivacySection = {
  id: string;
  title: string;
  body: string;
};

const privacySections: PrivacySection[] = [
  {
    id: "responsable",
    title: "Responsable del tratamiento",
    body:
      "Icave, o el area interna que este designe, es el responsable del tratamiento de los datos recabados y procesados en la plataforma. MetaWeb Dev Solutions participa como desarrollador y proveedor tecnologico del sistema, en los terminos y alcances que Icave haya autorizado para la operacion, mantenimiento, soporte o mejora del servicio. El tratamiento de la informacion se realiza con fines operativos, administrativos, de control, seguimiento y seguridad institucional.",
  },
  {
    id: "datos",
    title: "Datos que pueden ser recabados",
    body:
      "La plataforma puede recabar y procesar, segun corresponda, datos como nombre, correo electronico, identificadores de usuario, rol asignado, registros de acceso, actividad dentro del sistema, archivos cargados, comentarios, tareas relacionadas, metadatos de operacion y cualquier otra informacion necesaria para habilitar las funciones propias del servicio.",
  },
  {
    id: "finalidades",
    title: "Finalidades del tratamiento",
    body:
      "Los datos pueden utilizarse para autenticar usuarios, asignar permisos, gestionar tareas, mantener trazabilidad de actividades, revisar entregas, almacenar archivos, generar historiales de operacion, atender incidencias, aplicar controles de seguridad y mejorar el funcionamiento general del sistema.",
  },
  {
    id: "alcance",
    title: "Base y alcance del uso interno",
    body:
      "El tratamiento de la informacion se limita a lo necesario para la operacion institucional de la plataforma. El uso de los datos se realiza dentro del marco de las actividades internas, obligaciones operativas, controles administrativos y medidas de seguridad asociadas al acceso y uso del sistema.",
  },
  {
    id: "conservacion",
    title: "Conservacion de la informacion",
    body:
      "La informacion podra conservarse durante el tiempo necesario para cumplir con las finalidades operativas, de control, auditoria, respaldo, continuidad institucional, cumplimiento normativo o atencion de incidencias. Los periodos concretos de conservacion dependeran de la naturaleza de los datos y de las necesidades del servicio.",
  },
  {
    id: "comparticion",
    title: "Comparticion y acceso autorizado",
    body:
      "La informacion no debe compartirse fuera de los canales y areas autorizadas. No obstante, ciertos datos podran ser consultados por personal con funciones legitimas de administracion, supervision, auditoria, soporte tecnico o cumplimiento, siempre dentro del ambito permitido por la operacion institucional.",
  },
  {
    id: "seguridad",
    title: "Medidas de seguridad",
    body:
      "Se implementan medidas razonables de seguridad administrativas, tecnicas y operativas para proteger la informacion contra perdida, alteracion, acceso no autorizado, uso indebido o divulgacion indebida. Aun con ello, todo usuario debe contribuir al resguardo de la informacion mediante el uso responsable de sus credenciales y del sistema.",
  },
  {
    id: "derechos",
    title: "Derechos de los titulares",
    body:
      "Cuando resulte procedente conforme a la normativa aplicable, los titulares de los datos podran solicitar acceso, rectificacion, actualizacion, oposicion o supresion respecto de su informacion, a traves de los canales que la organizacion determine para tales efectos. La procedencia de cada solicitud dependera del contexto operativo, la base legal y las obligaciones institucionales existentes.",
  },
  {
    id: "cambios",
    title: "Cambios al aviso",
    body:
      "Este Aviso de Privacidad podra actualizarse para reflejar cambios en la operacion de la plataforma, en la normativa aplicable o en los procesos internos de tratamiento. Cualquier actualizacion se publicara en esta misma seccion y surtira efectos desde su publicacion.",
  },
  {
    id: "contacto",
    title: "Contacto interno",
    body:
      "Para dudas relacionadas con el uso de la informacion, el alcance de este Aviso de Privacidad o el ejercicio de derechos aplicables, el usuario debera ponerse en contacto con el area interna responsable de administracion, cumplimiento o soporte de la plataforma.",
  },
];

export default function PrivacidadPage() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-[#141414] sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <section className="px-1 py-6 sm:px-2 lg:px-0">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-[#151515] sm:text-5xl">
                Aviso De Privacidad
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-[#4b4741]">
                Este Aviso de Privacidad describe de manera general la forma en
                que la plataforma puede recabar, utilizar, almacenar,
                resguardar y administrar la informacion relacionada con sus
                usuarios, asi como los datos generados durante el uso del
                sistema. Su finalidad es informar de forma clara el tratamiento
                de la informacion dentro del entorno institucional de Icave.
              </p>
            </div>
          </div>
          <p className="mt-6 text-xs leading-6 text-[#6f6a63]">
            Ultima actualizacion: {currentYear}
          </p>
        </section>

        <section className="grid gap-6 px-1 py-8 sm:px-2 lg:grid-cols-[18rem_1fr] lg:px-0">
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-[#7a756d]">
                Navegacion
              </p>
              <div className="mt-4 space-y-3">
                {privacySections.map((section, index) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="flex items-center gap-3 text-sm text-[#4b4741] transition-colors hover:text-[#151515]"
                  >
                    <span className="text-xs font-semibold text-[#7a756d]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{section.title}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="pt-6">
              <p className="text-xs uppercase tracking-[0.28em] text-[#7a756d]">
                Resumen
              </p>
              <p className="mt-3 text-sm leading-7 text-[#4b4741]">
                Uso interno, tratamiento controlado de informacion, medidas de
                seguridad razonables y acceso bajo autorizacion institucional.
              </p>
            </div>
          </aside>

          <div className="space-y-4">
            {privacySections.map((section, index) => (
              <section
                id={section.id}
                key={section.id}
                className="py-4 sm:py-5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7a756d]">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[#151515]">
                  {section.title}
                </h2>
                <p className="mt-4 text-sm leading-8 text-[#4b4741]">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
