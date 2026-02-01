// ======================================================
// Agenda Agent — FullCalendar + Modale RDV
// ======================================================

// ---------------------------------
// Auth token
// ---------------------------------
function getToken() {
  return (
    localStorage.getItem("zentro_token") ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt")
  );
}

const token = getToken();
if (!token) {
  window.location.href = "/login";
}

// ---------------------------------
// DOM elements
// ---------------------------------
const calendarEl = document.getElementById("calendar");

// Modale
const modalEl       = document.getElementById("appointment-modal");
const modalTitleEl  = document.getElementById("appointment-modal-title");
const formEl        = document.getElementById("appointment-form");
const btnCloseEl    = document.getElementById("modal-close");
const btnCancelEl   = document.getElementById("modal-cancel");
const btnSaveEl     = document.getElementById("modal-save");

// Champs formulaire
const inputId           = document.getElementById("appointment-id");
const inputClientId     = document.getElementById("client-id");
const inputClientSearch = document.getElementById("client-search");
const inputStart        = document.getElementById("start-datetime");
const inputNotes        = document.getElementById("notes");
const inputStatus       = document.getElementById("status");

// Suggestions clients
const clientSuggestionsEl = document.getElementById("client-suggestions");

// Bouton global "nouveau RDV"
const btnOpenCreate = document.getElementById("btn-open-create");

// Tableau des rendez-vous
const tbodyAppointments  = document.getElementById("appointments-tbody");
const emptyRow           = document.getElementById("appointments-empty-row");

// Message global
const msgBox = document.getElementById("appointments-message");

// API
const API_APPOINTMENTS = "/api-zenhub/agent/appointments";
const API_CLIENTS      = "/api-zenhub/agent/clients";

// ---------------------------------
// Utils
// ---------------------------------
function showMessage(type, text) {
  if (!msgBox) return;
  msgBox.className = "alert alert-" + type;
  msgBox.textContent = text;
  msgBox.classList.remove("d-none");
  setTimeout(() => msgBox.classList.add("d-none"), 4000);
}

function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
}

function localInputToISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return d.toISOString();
}

function formatDateTimeFR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// ---------------------------------
// Modale
// ---------------------------------
function openModalForCreate(date) {
  if (!modalEl) return;

  modalTitleEl.textContent = "Nouveau rendez-vous";
  formEl.reset();
  inputId.value = "";
  inputClientId.value = "";
  inputClientSearch.value = "";

  const d = date ? new Date(date) : new Date();
  d.setHours(9, 0, 0, 0);
  inputStart.value = isoToLocalInput(d.toISOString());
  inputStatus.value = "planned";

  modalEl.classList.remove("d-none");
  modalEl.classList.add("modal-open");

  setTimeout(() => inputClientSearch.focus(), 50);
}

function openModalForEdit(appt) {
  if (!modalEl) return;

  modalTitleEl.textContent = "Modifier le rendez-vous";
  formEl.reset();

  inputId.value           = appt.id;
  inputClientId.value     = appt.client_id || "";
  inputClientSearch.value = appt.client_name || "";
  inputStart.value        = isoToLocalInput(appt.start_datetime);
  inputNotes.value        = appt.notes || "";
  inputStatus.value       = appt.status || "planned";

  modalEl.classList.remove("d-none");
  modalEl.classList.add("modal-open");

  setTimeout(() => inputClientSearch.focus(), 50);
}

function closeModal() {
  if (!modalEl) return;
  modalEl.classList.add("d-none");
  modalEl.classList.remove("modal-open");
}

// Boutons de la modale
btnCloseEl?.addEventListener("click", (e) => {
  e.preventDefault();
  closeModal();
});
btnCancelEl?.addEventListener("click", (e) => {
  e.preventDefault();
  closeModal();
});

// >>> IMPORTANT : bouton "Valider" déclenche le submit du formulaire
btnSaveEl?.addEventListener("click", (e) => {
  e.preventDefault();
  if (formEl) {
    formEl.requestSubmit();
  }
});

// ---------------------------------
// Autocomplétion client
// ---------------------------------
let clientSearchTimeout = null;

inputClientSearch?.addEventListener("input", (e) => {
  const q = e.target.value.trim();
  inputClientId.value = "";

  if (clientSearchTimeout) clearTimeout(clientSearchTimeout);
  clientSearchTimeout = setTimeout(() => searchClients(q), 250);
});

async function searchClients(q) {
  clientSuggestionsEl.innerHTML = "";
  if (!q) return;

  const url = `${API_CLIENTS}?search=${encodeURIComponent(q)}&page=1&page_size=10`;
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
  });

  if (!res.ok) {
    clientSuggestionsEl.innerHTML =
      '<div class="client-suggestion empty">Erreur de recherche</div>';
    return;
  }

  const data = await res.json();
  const items = data.items || [];

  if (!items.length) {
    clientSuggestionsEl.innerHTML =
      '<div class="client-suggestion empty">Aucun client</div>';
    return;
  }

  items.forEach((c) => {
    const name = c.company_name || c.company || "(Sans nom)";
    const addr = [c.zipcode, c.city].filter(Boolean).join(" ");
    const phone = c.phone || "";

    const div = document.createElement("div");
    div.className = "client-suggestion";
    div.innerHTML = `
      <strong>${name}</strong><br>
      <span>${addr}</span><br>
      <span>${phone}</span>
    `;
    div.addEventListener("click", () => {
      inputClientId.value = c.id;
      inputClientSearch.value = name;
      clientSuggestionsEl.innerHTML = "";
    });

    clientSuggestionsEl.appendChild(div);
  });
}

// Fermer la liste si on clique ailleurs
document.addEventListener("click", (e) => {
  if (!clientSuggestionsEl) return;
  if (
    !clientSuggestionsEl.contains(e.target) &&
    e.target !== inputClientSearch
  ) {
    clientSuggestionsEl.innerHTML = "";
  }
});

// ---------------------------------
// Soumission formulaire (create / update)
// ---------------------------------
formEl?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    client_id: inputClientId.value ? Number(inputClientId.value) : null,
    start_datetime: localInputToISO(inputStart.value),
    end_datetime: null, // backend gère la fin ( +30 min )
    notes: inputNotes.value || "",
    status: inputStatus.value || "planned",
  };

  if (!payload.start_datetime) {
    showMessage("danger", "Veuillez renseigner la date/heure.");
    return;
  }

  const isEdit = !!inputId.value;
  const url = isEdit ? `${API_APPOINTMENTS}/${inputId.value}` : API_APPOINTMENTS;
  const method = isEdit ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    showMessage("danger", "Erreur lors de l'enregistrement du rendez-vous.");
    return;
  }

  closeModal();
  showMessage("success", "Rendez-vous enregistré.");
  calendar?.refetchEvents();
});

// ---------------------------------
// Liste tableau des rendez-vous
// ---------------------------------
function renderAppointmentsList(appts) {
  if (!tbodyAppointments || !emptyRow) return;

  // Nettoyage (on garde seulement la ligne "vide")
  [...tbodyAppointments.querySelectorAll("tr")].forEach((tr) => {
    if (tr !== emptyRow) tr.remove();
  });

  if (!appts.length) {
    emptyRow.style.display = "";
    return;
  }
  emptyRow.style.display = "none";

  appts.forEach((a) => {
    const tr = document.createElement("tr");

    // Date
    const tdDate = document.createElement("td");
    tdDate.textContent = formatDateTimeFR(a.start_datetime);
    tr.appendChild(tdDate);

    // Client (lien vers /agent/client/{id} si dispo)
    const tdClient = document.createElement("td");
    if (a.client_id) {
      const link = document.createElement("a");
      link.href = `/agent/client/${a.client_id}`;
      link.textContent = a.client_name || "(Sans nom)";
      tdClient.appendChild(link);
    } else {
      tdClient.textContent = a.client_name || "(Sans nom)";
    }
    tr.appendChild(tdClient);

    // Notes
    const tdNotes = document.createElement("td");
    tdNotes.textContent = a.notes || "";
    tr.appendChild(tdNotes);

    // Statut
    const tdStatus = document.createElement("td");
    tdStatus.textContent = a.status;
    tr.appendChild(tdStatus);

    // Actions
    const tdActions = document.createElement("td");
    tdActions.className = "text-end";

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn btn-sm btn-outline-secondary";
    btnEdit.dataset.action = "edit";
    btnEdit.dataset.id = a.id;
    btnEdit.textContent = "✏️";

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "btn btn-sm btn-outline-danger ms-1";
    btnDelete.dataset.action = "delete";
    btnDelete.dataset.id = a.id;
    btnDelete.textContent = "🗑";

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDelete);
    tr.appendChild(tdActions);

    tbodyAppointments.appendChild(tr);
  });
}

// Délégation pour les boutons Edit / Delete
tbodyAppointments?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");

  if (action === "edit") {
    const ev = calendar?.getEventById(id);
    if (!ev) return;
    openModalForEdit({
      id: ev.id,
      client_id: ev.extendedProps.client_id,
      client_name: ev.extendedProps.client_name,
      start_datetime: ev.start,
      end_datetime: ev.end,
      notes: ev.extendedProps.notes,
      status: ev.extendedProps.status,
    });
  } else if (action === "delete") {
    if (!confirm("Supprimer ce rendez-vous ?")) return;

    const res = await fetch(`${API_APPOINTMENTS}/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      showMessage("danger", "Erreur lors de la suppression.");
      return;
    }

    showMessage("success", "Rendez-vous supprimé.");
    calendar?.refetchEvents();
  }
});

// ---------------------------------
// FullCalendar
// ---------------------------------
let calendar = null;

document.addEventListener("DOMContentLoaded", function () {
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    locale: "fr",
    themeSystem: "bootstrap5",

    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    },

    selectable: true,
    editable: false,

    events: async (info, success, failure) => {
      try {
        const params = new URLSearchParams({
          from: info.startStr,
          to: info.endStr,
        });

        const res = await fetch(`${API_APPOINTMENTS}?${params.toString()}`, {
          headers: { Authorization: "Bearer " + token },
        });

        if (!res.ok) {
          console.error("[AGENDA] erreur HTTP", res.status);
          failure(new Error("HTTP " + res.status));
          return;
        }

        const data = await res.json();

        const events = data.map((a) => ({
          id: a.id,
          title: a.client_name || "(Sans nom)",
          start: a.start_datetime,
          end: a.end_datetime || a.start_datetime,
          extendedProps: {
            notes: a.notes,
            status: a.status,
            client_id: a.client_id,
            client_name: a.client_name,
          },
        }));

        success(events);
        renderAppointmentsList(data);
      } catch (err) {
        console.error("[AGENDA] erreur chargement events", err);
        failure(err);
      }
    },

    eventClick(info) {
      openModalForEdit({
        id: info.event.id,
        client_id: info.event.extendedProps.client_id,
        client_name: info.event.extendedProps.client_name,
        start_datetime: info.event.start,
        end_datetime: info.event.end,
        notes: info.event.extendedProps.notes,
        status: info.event.extendedProps.status,
      });
    },

    dateClick(info) {
      document
        .querySelectorAll(".fc-selected-day")
        .forEach((el) => el.classList.remove("fc-selected-day"));
      document
        .querySelectorAll(".fc-add-rdv-btn")
        .forEach((btn) => btn.remove());

      info.dayEl.classList.add("fc-selected-day");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fc-add-rdv-btn btn btn-sm btn-primary";
      btn.textContent = "+ RDV";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openModalForCreate(info.dateStr);
      });
      info.dayEl.appendChild(btn);

      openModalForCreate(info.dateStr);
    },
  });

  calendar.render();
});

// ---------------------------------
// Bouton global "Nouveau rendez-vous"
// ---------------------------------
btnOpenCreate?.addEventListener("click", () => {
  openModalForCreate(new Date());
});
