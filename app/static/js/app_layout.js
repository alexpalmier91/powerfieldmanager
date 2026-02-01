const side = document.querySelector(".sidebar");
document.getElementById("toggleSidebar")?.addEventListener("click", () => {
  side.classList.toggle("open");
});
(function markActive(){
  const path = location.pathname;
  document.querySelectorAll(".menu .item").forEach(a => {
    const href = a.getAttribute("href") || "";
    if (href !== "/" && path.startsWith(href)) a.classList.add("active");
  });
})();
