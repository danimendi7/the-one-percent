import type { Topic } from "./types"

/**
 * Curated topics (PRD §4.2: «first launch supports curated offline topics without any API key»).
 * Original summaries written for this app. There is no source retrieval, so every one is labelled
 * «Síntesis sin verificar», cites no studies and has no links, and feed.test.ts enforces it.
 */
export const CATALOG: readonly Topic[] = [
  {
    key: "curated:dichotomy",
    title: "La dicotomía del control: qué depende de ti",
    category: "Filosofía",
    minutes: 5,
    origin: "curated",
    verification: "unverified",
    hook:
      "Una de las herramientas mentales más antiguas y prácticas cabe en una frase: distingue lo que depende de ti de lo que no, y pon tu energía solo en lo primero.",
    sections: [
      {
        heading: "La idea",
        body:
          "Epicteto, filósofo estoico del siglo I y II, abre su Enquiridión con esta separación. Dependen de nosotros nuestros juicios, intenciones, deseos y aversiones. No dependen de nosotros el cuerpo, la reputación, los bienes o los cargos. El sufrimiento evitable aparece cuando tratamos lo segundo como si fuera lo primero.",
      },
      {
        heading: "El mecanismo",
        body:
          "La propuesta no es resignación, sino asignación de atención. Si el objetivo es «ganar la carrera», el resultado depende de rivales, clima y azar. Si el objetivo es «entrenar bien cada sesión y competir con la mejor estrategia», el objetivo vive dentro de tu control y el resultado deja de dictar tu estado de ánimo.",
      },
      {
        heading: "Un ejemplo",
        body:
          "Antes de una reunión difícil: no controlas la reacción del otro; sí controlas tu preparación, el tono y la claridad de tu propuesta. Prepararte para eso reduce la ansiedad y suele mejorar el resultado.",
      },
      {
        heading: "Matices y límites",
        body:
          "La frontera no siempre es binaria: muchas cosas dependen de nosotros solo en parte. Algunos autores modernos proponen una «tricotomía» (control total, parcial y nulo). Usada mal, la idea puede justificar pasividad ante problemas que sí admiten acción colectiva.",
      },
      {
        heading: "Uso práctico",
        body:
          "Reformula cada objetivo de resultado en uno de proceso. En THE ONE PERCENT esto ya ocurre: los hábitos miden esfuerzo y los objetivos miden resultado, por separado.",
      },
    ],
    takeaway: "Mide tu día por lo que hiciste con lo que dependía de ti, no por lo que el mundo te devolvió.",
    recallQuestion: "¿Cómo se reformula un objetivo de resultado para que dependa de ti?",
    references: [
      { title: "Epicteto, Enquiridión, capítulo 1", note: "Fuente primaria clásica, citada sin enlace." },
    ],
  },
  {
    key: "curated:occam",
    title: "La navaja de Occam: no multipliques las explicaciones",
    category: "Filosofía",
    minutes: 3,
    origin: "curated",
    verification: "unverified",
    hook: "Cuando dos explicaciones dan cuenta de lo mismo, conviene empezar por la que necesita menos supuestos.",
    sections: [
      { heading: "La idea", body: "El principio lleva el nombre de Guillermo de Ockham, fraile y filósofo medieval. No dice que lo simple sea siempre cierto: dice que no añadas piezas a una explicación sin necesidad." },
      { heading: "El mecanismo", body: "Cada supuesto extra es un punto más en el que la explicación puede fallar. Con igual poder explicativo, la versión con menos supuestos es más fácil de comprobar y de descartar." },
      { heading: "Matices y límites", body: "Es una regla para elegir por dónde investigar, no una prueba. La realidad a veces es complicada, y la explicación simple puede estar equivocada." },
    ],
    takeaway: "Empieza por la explicación con menos supuestos y añade piezas solo cuando los hechos lo exijan.",
    recallQuestion: "¿Qué afirma la navaja de Occam, y qué no afirma?",
    references: [],
  },
  {
    key: "curated:lindy",
    title: "El efecto Lindy: lo que ha durado tiende a durar",
    category: "Filosofía",
    minutes: 3,
    origin: "curated",
    verification: "unverified",
    hook: "Para ciertas cosas que no envejecen, como una idea o un libro, cada año que sobreviven es un indicio de que aún les queda vida.",
    sections: [
      { heading: "La idea", body: "Un objeto físico se desgasta con el tiempo. Una idea, una técnica o un libro no: si sigue vivo tras mucho tiempo, ha superado muchos filtros." },
      { heading: "El mecanismo", body: "Lo que resiste sucesivas modas y críticas suele resolver un problema real. La supervivencia pasada funciona como una prueba acumulada." },
      { heading: "Matices y límites", body: "Es una heurística, no una ley: no se aplica a lo que envejece, y lo antiguo también puede sobrevivir por inercia o por poder." },
    ],
    takeaway: "Antes de perseguir lo nuevo, pregunta qué lleva mucho tiempo funcionando y por qué.",
    recallQuestion: "¿A qué tipo de cosas se aplica el efecto Lindy y a cuáles no?",
    references: [],
  },
  {
    key: "curated:compounding",
    title: "Interés compuesto fuera de las finanzas",
    category: "Economía",
    minutes: 3,
    origin: "curated",
    verification: "unverified",
    hook: "Lo que crece sobre lo ya crecido parece lento al principio y sorprende después.",
    sections: [
      { heading: "La idea", body: "En el interés compuesto, cada periodo gana también sobre lo ganado antes. El mismo patrón aparece en el conocimiento, las relaciones o la salud cuando lo acumulado facilita lo siguiente." },
      { heading: "El mecanismo", body: "Un 1 % de mejora sobre una base que aumenta no suma: multiplica. Por eso la curva apenas se nota durante mucho tiempo y luego se empina." },
      { heading: "Matices y límites", body: "Nada crece así para siempre: aparecen límites, y también funciona al revés. Pequeñas pérdidas repetidas se acumulan igual." },
    ],
    takeaway: "Busca lo que se apoya en sí mismo y no lo interrumpas cuando aún no se nota.",
    recallQuestion: "¿Por qué el crecimiento compuesto parece lento al principio?",
    references: [],
  },
  {
    key: "curated:opportunity",
    title: "Coste de oportunidad: lo que dejas de hacer",
    category: "Economía",
    minutes: 3,
    origin: "curated",
    verification: "unverified",
    hook: "El precio real de una decisión incluye la mejor alternativa a la que renuncias.",
    sections: [
      { heading: "La idea", body: "Toda elección descarta otras. El coste de oportunidad es el valor de la mejor opción descartada, aunque no aparezca en ninguna factura." },
      { heading: "El mecanismo", body: "Tendemos a mirar lo que pagamos y a ignorar lo que dejamos de ganar. Decir sí a un compromiso es decir no a todo lo que ocuparía ese tiempo." },
      { heading: "Matices y límites", body: "La mejor alternativa rara vez se conoce con certeza. Sirve para comparar opciones reales, no para torturarse con todas las posibles." },
    ],
    takeaway: "Antes de aceptar algo, pregunta a qué le estás diciendo que no.",
    recallQuestion: "¿Qué se compara al calcular un coste de oportunidad?",
    references: [],
  },
  {
    key: "curated:spacing",
    title: "Por qué repasar espaciado vence a releer",
    category: "Ciencia",
    minutes: 5,
    origin: "curated",
    verification: "unverified",
    hook: "Releer da sensación de dominio; recuperar de memoria tras un tiempo es lo que afianza lo aprendido.",
    sections: [
      { heading: "La idea", body: "Releer un texto lo hace familiar, y la familiaridad se confunde con el conocimiento. Intentar recordarlo sin mirar obliga a reconstruirlo." },
      { heading: "El mecanismo", body: "Dejar pasar tiempo entre repasos hace que recordar cueste algo más, y ese esfuerzo es parte de lo que fortalece la memoria." },
      { heading: "Matices y límites", body: "No sustituye a entender: repasar algo mal comprendido solo afianza el error. Los intervalos adecuados varían según la persona y la materia." },
    ],
    takeaway: "Si solo vuelves a leerlo, sabrás reconocerlo; si intentas recordarlo, sabrás usarlo.",
    recallQuestion: "¿Por qué releer puede dar una falsa sensación de dominio?",
    references: [],
  },
  {
    key: "curated:confirmation",
    title: "Sesgo de confirmación: ver lo que ya creemos",
    category: "Ciencia",
    minutes: 3,
    origin: "curated",
    verification: "unverified",
    hook: "Solemos buscar y recordar aquello que confirma lo que ya pensábamos.",
    sections: [
      { heading: "La idea", body: "Ante una misma información, tendemos a dar más peso a lo que encaja con nuestras creencias y a poner más pegas a lo que las contradice." },
      { heading: "El mecanismo", body: "Comprobar una idea buscando solo ejemplos a favor siempre parece funcionar. Lo que la pondría a prueba son los casos que podrían desmentirla." },
      { heading: "Matices y límites", body: "Saber que existe no protege de él. Ayuda más cambiar el procedimiento: pedir la opinión contraria o decidir de antemano qué te haría cambiar de idea." },
    ],
    takeaway: "Pregunta qué tendría que ocurrir para que estuvieras equivocado.",
    recallQuestion: "¿Qué tipo de casos ponen de verdad a prueba una idea?",
    references: [],
  },
  {
    key: "curated:printing",
    title: "La imprenta y la explosión del conocimiento",
    category: "Historia",
    minutes: 5,
    origin: "curated",
    verification: "unverified",
    hook: "Abaratar la copia de textos cambió quién podía leer, discutir y corregir las ideas.",
    sections: [
      { heading: "La idea", body: "Antes de la imprenta de tipos móviles, en la Europa del siglo XV, copiar un libro era lento y caro. Al poder reproducirlo en serie, circularon muchos más textos." },
      { heading: "El mecanismo", body: "Más copias idénticas permitían comparar, citar y corregir errores entre lectores lejanos. Las ideas podían acumularse en lugar de perderse." },
      { heading: "Matices y límites", body: "No fue un efecto inmediato ni solo positivo: también se difundieron falsedades, y la alfabetización tardó en extenderse. En Asia ya existían formas de impresión anteriores." },
    ],
    takeaway: "Cuando copiar y distribuir se abarata, cambia quién participa en la conversación.",
    recallQuestion: "¿Por qué importaba que las copias fueran idénticas?",
    references: [],
  },
  {
    key: "curated:network",
    title: "Efectos de red: cuando el valor crece con los usuarios",
    category: "Tecnología",
    minutes: 3,
    origin: "curated",
    verification: "unverified",
    hook: "Algunos productos valen más cuanta más gente los usa, y eso cambia cómo compiten.",
    sections: [
      { heading: "La idea", body: "Un teléfono solo no sirve de nada; su utilidad depende de a cuántas personas puedas llamar. Lo mismo ocurre con redes sociales o mercados digitales." },
      { heading: "El mecanismo", body: "Cada persona nueva aumenta el valor para las demás, lo que atrae a más gente. Ese círculo favorece que un servicio concentre gran parte del mercado." },
      { heading: "Matices y límites", body: "Más usuarios no siempre es mejor: puede haber saturación, ruido o spam, y el valor depende de quién está, no solo de cuántos." },
    ],
    takeaway: "Pregunta si algo mejora porque es bueno o porque ya lo usa todo el mundo.",
    recallQuestion: "¿Qué círculo se crea en un producto con efecto de red?",
    references: [],
  },
]
