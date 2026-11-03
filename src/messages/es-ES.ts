/**
 * The single place where interface copy lives.
 *
 * Nothing user-facing is written inline in a component or a Route Handler.
 * Every error message ends with a concrete next action, because SC-012 asks for
 * 100 % of them, not most of them.
 */

const SALON_PHONE_PLACEHOLDER = '{phone}';

export const messages = {
  common: {
    appName: 'Reserva tu cita',
    /** FR-033: the screen says whose clock these hours belong to. */
    timezoneLabel: 'Horario de Madrid',
    timezoneNotice: 'Todas las horas son las del salón, en horario de Madrid.',
    /** Short weekday names, indexed by ISO weekday: 1 = lunes … 7 = domingo. */
    weekdayShort: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
    weekdayLong: [
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ],
    monthLong: [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ],
    minutesSuffix: 'min',
    hoursSuffix: 'h',
    /** FR-019: a service with no price yet. Never "0,00 €", which reads as free. */
    priceOnRequest: 'Precio a consultar en el salón',
    /** FR-020: after the sum of the prices that are known, when some are not. */
    partialPriceSuffix: '+ precio a consultar en el salón',
    loading: 'Cargando…',
    back: 'Volver',
  },

  availability: {
    title: 'Reserva tu cita',
    serviceSectionTitle: 'Elige los servicios',
    serviceSectionHint: 'Puedes elegir uno o varios. Duración y precio orientativos.',
    /** FR-023: a chosen service says so in words and a mark, never by colour alone. */
    selectedServiceMark: 'Elegido',
    selectedServicesLabel: 'Servicios elegidos',
    totalDurationLabel: 'Duración total',
    /** FR-004: in place of the days and hours while nothing is chosen. */
    emptySelection: 'Elige al menos un servicio para ver los días y las horas libres.',
    /** FR-010, D-007: no opening stretch of the week is long enough. */
    selectionTooLong: {
      message: 'Los servicios que has elegido duran {duration}, más que cualquier franja del salón.',
      nextAction: `Quita alguno o llama al salón al ${SALON_PHONE_PLACEHOLDER} y buscamos cómo hacerlo.`,
    },
    /** FR-011, D-005: the chosen hour no longer fits the new selection. */
    hourRemoved: {
      message: 'La hora que habías elegido ya no cabe con los servicios nuevos.',
      nextAction: 'Elige otra hora de ese día; lo que escribiste en el formulario se conserva.',
    },
    daySectionTitle: 'Elige el día',
    dayGridLabel: 'Días disponibles',
    slotSectionTitle: 'Elige la hora',
    slotsLabel: 'Horas disponibles',

    /** D-014: each state carries text, a shape and a colour — never colour alone. */
    status: {
      available: { label: 'con huecos', icon: '•' },
      full: { label: 'sin huecos', icon: '×' },
      closed: { label: 'cerrado', icon: '—' },
    },

    dayAccessibleName: (parts: {
      weekday: string;
      day: string;
      month: string;
      status: string;
      slotCount: number;
    }) =>
      parts.slotCount > 0
        ? `${parts.weekday} ${parts.day} de ${parts.month}, ${parts.slotCount} ${
            parts.slotCount === 1 ? 'hueco' : 'huecos'
          }`
        : `${parts.weekday} ${parts.day} de ${parts.month}, ${parts.status}`,

    noSlotsToday: 'Este día no queda ninguna hora libre para lo que has elegido.',
    dayClosed: 'El salón está cerrado este día.',
    jumpToNext: (date: string) => `Ir al ${date}, el siguiente día con huecos`,
    noneInHorizon:
      'No queda ningún hueco para lo que has elegido en los próximos 60 días. Llama al salón y buscamos una fecha.',
    slotCountSummary: (count: number) =>
      count === 1 ? 'Queda 1 hora libre.' : `Quedan ${count} horas libres.`,
    /** 003, FR-010: on desktop, what appears beside the hours once one is chosen. */
    chooseHourHint:
      'Elige una hora y aquí verás el resumen de tu cita y el formulario para tus datos.',
    selectedSlot: 'Elegida',

    previousRange: 'Ver los 14 días anteriores',
    nextRange: 'Ver los 14 días siguientes',
    cannotGoBack: 'No se pueden reservar días pasados.',
    cannotGoForward: 'La agenda aún no está abierta para fechas posteriores.',
  },

  booking: {
    title: 'Tus datos',
    /** The document title, read out by the route announcer on arrival (003, D-007). */
    pageTitle: 'Tus datos · Reserva tu cita',
    summaryTitle: 'Lo que vas a reservar',
    summaryService: 'Servicio',
    /** 005: with more than one service the label goes plural; with one, as in 001. */
    summaryServices: 'Servicios',
    summaryDate: 'Día',
    summaryTime: 'Hora',
    summaryDuration: 'Duración',
    summaryPrice: 'Precio',
    summaryCancellationPolicy: 'Puedes cancelar',
    cancellationPolicyValue: (hours: number) => `hasta ${hours} horas antes`,

    /** FR-008: exactly three fields, and no fourth one. */
    formTitle: 'Déjanos tres datos',
    nameLabel: 'Nombre',
    nameHint: 'Como quieras que te llamemos.',
    phoneLabel: 'Teléfono',
    phoneHint: 'Un teléfono español de 9 cifras, por ejemplo 600 11 22 33.',
    emailLabel: 'Email',
    emailHint: 'Por si necesitamos avisarte de algo.',
    submit: 'Confirmar la cita',
    errorSummaryTitle: 'Revisa estos datos antes de confirmar:',
    dataUse:
      'Sólo guardamos estos tres datos, y los borramos a los 12 meses de tu cita.',
    missingSlot: {
      message: 'No hemos podido saber qué hora querías reservar.',
      nextAction: 'Vuelve a la pantalla de reservas y elige la hora otra vez.',
    },
  },

  confirmation: {
    title: '¡Cita confirmada!',
    intro: 'Te esperamos. Esto es lo que has reservado:',
    /** FR-015: the link is the only way back, and v1 sends no message. */
    saveLinkTitle: 'Guarda este enlace',
    saveLinkWarning:
      'Es la única forma de volver a tu cita para consultarla, cambiarla o cancelarla. No te lo vamos a enviar por SMS ni por email, así que guárdalo ahora: añádelo a favoritos o hazle una captura.',
    linkLabel: 'Enlace de tu cita',
  },

  appointment: {
    title: 'Tu cita',
    salonTitle: 'Dónde y con quién',
    salonName: 'Salón',
    salonAddress: 'Dirección',
    salonPhone: 'Teléfono',
    statusLabel: 'Estado',
    status: {
      CONFIRMED: { label: 'Confirmada', icon: '✓' },
      CANCELLED: { label: 'Cancelada', icon: '×' },
      COMPLETED: { label: 'Completada', icon: '✓' },
    },
    cancelAction: 'Cancelar la cita',
    rescheduleAction: 'Cambiar de hora',
    bookAnother: 'Reservar una cita nueva',
    completedNote: 'Esta cita ya ha pasado. Puedes consultarla, pero no cambiarla.',
    cancelledNote: 'Esta cita está cancelada. Si quieres venir, reserva una nueva.',

    /**
     * FR-028: the reason comes from the domain block; only the wording is here.
     */
    unavailable: {
      TOO_LATE: `Faltan menos de {hours} horas para tu cita, así que ya no puedes cambiarla desde aquí. Llama al salón al ${SALON_PHONE_PLACEHOLDER} y lo resolvemos.`,
      ALREADY_CANCELLED: `Esta cita ya está cancelada, así que no hay nada más que cambiar. Reserva una nueva o llama al salón al ${SALON_PHONE_PLACEHOLDER}.`,
      ALREADY_COMPLETED: `Esta cita ya ha pasado y no se puede modificar. Reserva una nueva o llama al salón al ${SALON_PHONE_PLACEHOLDER}.`,
    },
  },

  cancellation: {
    /** FR-022: nothing is cancelled without the client saying so twice. */
    confirmTitle: '¿Seguro que quieres cancelar?',
    confirmQuestion: 'Vamos a cancelar esta cita y liberar la hora para otra persona.',
    confirmWarning: 'No se puede deshacer. Si cambias de idea tendrás que reservar de nuevo.',
    confirmYes: 'Sí, cancelar la cita',
    confirmNo: 'No, quedarme con la cita',
    blocked: 'No hemos podido cancelar esta cita.',
  },

  reschedule: {
    title: 'Cambiar de hora',
    /**
     * FR-024, 005 FR-017: the services are fixed; only the hour is on the
     * table. With one service it reads as in 001.
     */
    sameServiceNotice: (services: readonly string[]) =>
      services.length === 1
        ? `Estás cambiando la hora de tu ${services[0] ?? ''}. El servicio no cambia; si quieres otro, cancela esta cita y reserva una nueva.`
        : `Estás cambiando la hora de tu cita (${listOf(services)}). Los servicios no cambian; si quieres otros, cancela esta cita y reserva una nueva.`,
    /** FR-027: the slot the appointment already holds, offered and marked. */
    currentSlot: 'tu hora actual',
    confirmTitle: '¿Cambias tu cita a esta hora?',
    confirmYes: 'Sí, cambiar a esta hora',
    confirmNo: 'No, dejarlo como está',
    linkUnchanged: 'Tu enlace no cambia: el que guardaste sigue valiendo.',
    /** Historia 6, escenario 5: choosing the hour already held. */
    unchanged: {
      message: 'Esa es la hora que ya tenías, así que no hemos cambiado nada.',
      nextAction: 'Elige otra hora si quieres moverla, o vuelve a tu cita.',
    },
    blocked: 'No hemos podido cambiar la hora de esta cita.',
    slotTaken: {
      message: 'Esa hora acaba de ocuparla otra persona, así que tu cita sigue donde estaba.',
      nextAction: 'Elige otra de las horas libres, aquí debajo.',
    },
  },

  errors: {
    /**
     * FR-019 and FR-038: the same words for a link that never existed, one that
     * is malformed, one whose appointment was deleted, one anonymised by
     * retention, and one that hit the per-IP limit. Nothing here hints that any
     * of those cases are told apart.
     */
    appointmentNotFound: {
      message: 'No hemos encontrado ninguna cita con este enlace.',
      nextAction: 'Puedes reservar una cita nueva desde la página de reservas.',
    },
    unknownService: {
      message: 'Ese servicio ya no está disponible.',
      nextAction: 'Elige otro servicio del catálogo para ver sus horas libres.',
    },
    /** 005, FR-015: withdrawn between choosing it and confirming. */
    serviceUnavailable: {
      message: 'Uno de los servicios que habías elegido ha dejado de ofrecerse.',
      nextAction: 'Revisa los servicios elegidos, ya sin ese, y vuelve a confirmar.',
    },
    /** 005, FR-004: no days or hours until at least one service is chosen. */
    emptySelection: {
      message: 'No has elegido ningún servicio.',
      nextAction: 'Elige al menos un servicio para ver los días y las horas libres.',
    },
    rangeOutOfBounds: {
      message: 'Esas fechas están fuera de la agenda abierta.',
      nextAction: 'Vuelve a la pantalla de reservas y elige un día de los próximos 60.',
    },
    unexpected: {
      message: 'No hemos podido completar la operación.',
      nextAction: `Vuelve a intentarlo en unos segundos. Si sigue fallando, llama al salón al ${SALON_PHONE_PLACEHOLDER}.`,
    },

    /** One message per contact field, saying what a good value looks like. */
    contactField: {
      INVALID_NAME: 'Escribe tu nombre, de 1 a 100 caracteres.',
      INVALID_PHONE: 'Escribe un teléfono español de 9 cifras, por ejemplo 600 11 22 33.',
      INVALID_EMAIL: 'Escribe un email con esta forma: nombre@dominio.com.',
    },
    invalidContact: {
      message: 'Revisa los datos marcados.',
      nextAction: 'Corrige los campos señalados y vuelve a confirmar.',
    },

    slotTaken: {
      message: 'Esa hora acaba de ocuparla otra persona.',
      nextAction: 'Elige otra de las horas que quedan libres ese día, aquí debajo.',
    },
    tooLateToBook: {
      message: 'Esa hora ya está a menos de 2 horas y ha dejado de reservarse.',
      nextAction: 'Elige una hora más adelante, entre las que quedan libres aquí debajo.',
    },
    outsideOpeningHours: {
      message: 'Esa hora ya no está entre las que ofrece el salón.',
      nextAction: 'Elige una de las horas disponibles aquí debajo.',
    },
    contactLimitReached: {
      message: 'Ya tienes 3 citas reservadas por delante, que es el máximo.',
      nextAction: `Cancela una de las que tienes o llama al salón al ${SALON_PHONE_PLACEHOLDER}.`,
    },
    tooManyBookings: {
      message: 'Hemos recibido muchas reservas desde tu conexión en poco tiempo.',
      nextAction: `Vuelve a intentarlo dentro de un rato o llama al salón al ${SALON_PHONE_PLACEHOLDER} y te damos la cita por teléfono.`,
    },
  },

  /**
   * The owner's side (002). She is spoken to as «tú», like the client, and
   * every error says what to do next (FR-059).
   */
  owner: {
    title: 'Gestión del salón',
    nav: {
      label: 'Gestión del salón',
      agenda: 'Agenda',
      bookings: 'Reservas',
      account: 'Tu cuenta',
      signOut: 'Cerrar sesión',
    },
    busy: 'Un momento…',

    signIn: {
      title: 'Entrar en la gestión del salón',
      username: 'Usuario',
      password: 'Contraseña',
      submit: 'Entrar',
      submitting: 'Entrando…',
      /** FR-005: what to do, with no operational detail. */
      forgotten:
        'Si has olvidado la contraseña, no se puede recuperar desde aquí: pide que te den una nueva.',
    },

    agenda: {
      title: 'Agenda',
      dayPicker: 'Elegir el día',
      dateLabel: 'Día',
      go: 'Ver ese día',
      previous: 'Día anterior',
      next: 'Día siguiente',
      today: 'Hoy',
      showCancelled: 'Mostrar también las canceladas',
      hideCancelled: 'Ocultar las canceladas',
      /** FR-017: closed and empty are different things, and say so. */
      closed: 'El salón está cerrado este día.',
      noAppointments: 'No hay ninguna cita este día.',
      readOnly: 'Este día ya ha pasado: puedes consultarlo, pero no cambiar nada.',
      free: 'Libre',
      unavailable: 'No disponible',
      past: 'Ya ha terminado',
      phone: 'Teléfono',
      email: 'Email',
      anonymized: 'Datos del cliente borrados por antigüedad',
    },

    /** FR-013: the origin with text and an icon, never colour alone. */
    origin: {
      ONLINE: { label: 'Reservada online', icon: '@' },
      OWNER: { label: 'Apuntada por ti', icon: '✎' },
    },

    /** FR-063, D-037: who cancelled, as the owner reads it. */
    cancelledBy: {
      CUSTOMER: 'Cancelada por el cliente',
      OWNER: 'Cancelada por ti',
    },

    account: {
      title: 'Tu cuenta',
      changePassword: 'Cambiar la contraseña',
      current: 'Contraseña actual',
      next: 'Contraseña nueva',
      /** `{min}` comes from the domain's MIN_PASSWORD_LENGTH (D-016). */
      nextHint: 'Al menos {min} caracteres. No hace falta que lleve números ni símbolos.',
      submit: 'Guardar la contraseña nueva',
      saved: 'Contraseña cambiada. Si tenías la gestión abierta en otro aparato, allí tendrás que volver a entrar.',
      signOutHint: 'Cierra la sesión si dejas este aparato al alcance de otras personas.',
    },

    errors: {
      /** FR-008, FR-009: one answer for an unknown user, a wrong password and a lock. */
      signInRejected: {
        message: 'El usuario o la contraseña no son correctos.',
        nextAction: 'Revisa los dos datos y vuelve a intentarlo.',
      },
      /** FR-002, FR-007: no session, or an idle one. Nothing else is said. */
      unauthenticated: {
        message: 'Tienes que entrar en la gestión del salón.',
        nextAction: 'Vuelve a entrar con tu usuario y tu contraseña.',
      },
      badRequest: {
        message: 'No hemos entendido la petición.',
        nextAction: 'Vuelve a la pantalla anterior y repite la operación.',
      },
      wrongCurrentPassword: {
        message: 'La contraseña actual no es correcta.',
        nextAction: 'Escribe la contraseña con la que has entrado hoy.',
      },
      passwordTooShort: {
        message: 'La contraseña nueva es demasiado corta.',
        nextAction: 'Escribe una de al menos {min} caracteres.',
      },
      unexpected: {
        message: 'No hemos podido completar la operación.',
        nextAction: 'Vuelve a intentarlo en unos segundos.',
      },
    },
  },
} as const;

/** `Corte`, `Corte y Lavado`, `Corte, Color y Lavado`: how a list is said in Spanish. */
function listOf(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  return items.length < 2 ? last : `${items.slice(0, -1).join(', ')} y ${last}`;
}

/** Fills the salon phone into a message that offers it as the way out (FR-028). */
export function withPhone(text: string, phone: string): string {
  return text.replaceAll(SALON_PHONE_PLACEHOLDER, phone);
}

/** Fills a minimum the domain owns into its message, so the copy never restates it. */
export function withMin(text: string, min: number): string {
  return text.replaceAll('{min}', String(min));
}

export type Messages = typeof messages;
