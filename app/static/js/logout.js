console.log("[LOGOUT] logout.js chargé");

function logout() {
  console.log("[LOGOUT] clic détecté");

  localStorage.removeItem("zentro_token");
  localStorage.removeItem("token");
  localStorage.removeItem("jwt");
  localStorage.removeItem("prev_token");
  localStorage.removeItem("impersonated");

  sessionStorage.clear();

  window.location.replace("/");
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("logoutBtn");
  if (!btn) {
    console.warn("[LOGOUT] bouton logout introuvable");
    return;
  }

  btn.addEventListener("click", logout);
});
