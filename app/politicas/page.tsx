type PolicySection = {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
};

const policySections: PolicySection[] = [
  {
    id: "objeto",
    title: "Objeto de la plataforma",
    body:
      "Esta plataforma esta destinada a la gestion de acceso, seguimiento de actividades, asignacion de tareas, carga de archivos, registro de comentarios, monitoreo operativo y administracion de usuarios de Icave. Su uso esta limitado a fines institucionales y a actividades estrictamente relacionadas con las funciones autorizadas dentro del sistema. El desarrollo, soporte y evolucion tecnologica del producto pueden ser realizados por MetaWeb Dev Solutions conforme a los alcances definidos con Icave.",
  },
  {
    id: "acceso",
    title: "Acceso y autorizacion",
    body:
      "El acceso esta reservado a usuarios previamente autorizados. Las credenciales de ingreso son personales e intransferibles. Cada usuario es responsable de la informacion que gestiona dentro de su cuenta y del uso adecuado de los permisos asignados conforme a su rol. Queda prohibido compartir cuentas, suplantar identidades o intentar obtener acceso a informacion o funciones no autorizadas.",
  },
  {
    id: "uso",
    title: "Uso permitido",
    body:
      "El usuario se obliga a utilizar la plataforma de manera diligente, licita y conforme a su finalidad. En particular, podra usarla para consultar informacion operativa, gestionar tareas, cargar entregables, dejar comentarios, revisar estatus y realizar las acciones que correspondan a su perfil de acceso dentro del sistema.",
  },
  {
    id: "prohibidos",
    title: "Usos prohibidos",
    body:
      "El uso del sistema debe mantenerse dentro de parametros institucionales, de seguridad y de cumplimiento operativo.",
    bullets: [
      "Alterar, destruir, ocultar o manipular informacion sin autorizacion.",
      "Cargar archivos maliciosos, codigo dañino o contenido que afecte la seguridad del sistema.",
      "Obtener, intentar obtener o compartir datos de otros usuarios sin autorizacion expresa.",
      "Utilizar la plataforma para fines personales, ajenos a la operacion o contrarios a las politicas internas.",
      "Interferir con el funcionamiento, disponibilidad o integridad del servicio.",
    ],
  },
  {
    id: "contenido",
    title: "Responsabilidad sobre contenido y archivos",
    body:
      "Todo archivo, comentario, registro, tarea o dato ingresado al sistema debe ser veraz, pertinente y estar relacionado con la operacion institucional. El usuario reconoce que cualquier informacion cargada al sistema puede quedar sujeta a revisiones, auditorias internas, trazabilidad operativa y controles de cumplimiento.",
  },
  {
    id: "seguridad",
    title: "Seguridad y confidencialidad",
    body:
      "Los usuarios deben resguardar sus credenciales, cerrar sesion al finalizar el uso y evitar el acceso desde dispositivos o redes no confiables. La informacion consultada o generada dentro de la plataforma debe tratarse como confidencial cuando su naturaleza, clasificacion o uso institucional asi lo requieran.",
  },
  {
    id: "cambios",
    title: "Disponibilidad y cambios",
    body:
      "La organizacion podra actualizar, restringir, suspender o modificar funciones, accesos, modulos, roles o contenidos de la plataforma cuando sea necesario por razones tecnicas, operativas, de mantenimiento, seguridad o cumplimiento normativo, sin que ello genere derecho a reclamacion por interrupciones razonables del servicio.",
  },
  {
    id: "incumplimiento",
    title: "Incumplimiento",
    body:
      "El incumplimiento de estas Politicas podra dar lugar a la suspension temporal o definitiva del acceso, a medidas administrativas internas y, en su caso, a las acciones legales o disciplinarias que resulten procedentes conforme a la normativa aplicable y a las reglas internas de la organizacion.",
  },
  {
    id: "aceptacion",
    title: "Aceptacion",
    body:
      "El uso continuo de esta plataforma implica que el usuario conoce, entiende y acepta las presentes Politicas. En caso de no estar de acuerdo con su contenido o con posteriores actualizaciones, debera abstenerse de utilizar el sistema y notificarlo al area responsable.",
  },
];

export default function PoliticasPage() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-[#141414] sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <section className="px-1 py-6 sm:px-2 lg:px-0">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-[#151515] sm:text-5xl">
                Politicas De Uso
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-[#4b4741]">
                Las presentes Politicas regulan el acceso, uso y operacion de
                esta plataforma interna de Icave, desarrollada por MetaWeb Dev
                Solutions. Toda persona que acceda, navegue, cargue informacion
                o utilice cualquiera de sus funciones acepta cumplir estas
                disposiciones, asi como las reglas internas, lineamientos
                operativos y medidas de seguridad aplicables dentro del entorno
                institucional de Icave.
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
                {policySections.map((section, index) => (
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
                Alcance
              </p>
              <p className="mt-3 text-sm leading-7 text-[#4b4741]">
                Aplicable a usuarios autorizados, revisores, supervisores y
                personal con acceso legitimo a la operacion de la plataforma.
              </p>
            </div>
          </aside>

          <div className="space-y-4">
            {policySections.map((section, index) => (
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
                {section.bullets && (
                  <ul className="mt-5 list-disc space-y-3 pl-5 text-sm leading-8 text-[#4b4741]">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
