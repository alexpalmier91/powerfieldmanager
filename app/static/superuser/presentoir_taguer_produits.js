// app/static/superuser/presentoir_taguer_produits.js

(function () {
  const scanBtn = document.getElementById("btn-scan");
  const assignBtn = document.getElementById("btn-assign");
  const resultEl = document.getElementById("scan-result");

  let scanData = null;

  // -----------------------------
  // Helpers
  // -----------------------------
  function getTokenHeaders() {
    const TOKEN = localStorage.getItem("token");
    const headers = { Accept: "application/json" };
    if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
    return headers;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setScanLoading(isLoading) {
    if (!scanBtn) return;
    scanBtn.disabled = !!isLoading;
    scanBtn.innerText = isLoading ? "Scan en cours…" : "Scanner les tags présents";
  }

  function setAssignLoading(isLoading) {
    if (!assignBtn) return;
    assignBtn.disabled = !!isLoading;
    assignBtn.innerText = isLoading ? "Attribution…" : "Attribuer ce produit aux tags";
  }

  function extractItemsAndEpcsFromScan(data) {
    // On accepte plusieurs formats :
    // - { items: [{epc, already_linked? ...}], total, free_count, linked_count }
    // - { epcs: ["..."], ... }
    // - { tags: ["..."], ... } (fallback)
    const items = Array.isArray(data?.items) ? data.items : [];
    let epcs = [];

    if (items.length) {
      epcs = items.map((i) => i?.epc).filter(Boolean);
    } else if (Array.isArray(data?.epcs)) {
      epcs = data.epcs.filter(Boolean);
    } else if (Array.isArray(data?.tags)) {
      epcs = data.tags.filter(Boolean);
    }

    // Déductions “linked/free” :
    const total = epcs.length;
    let linked = 0;
    let free = 0;

    if (items.length) {
      linked = items.filter((i) => !!(i.already_linked || i.linked_display_product_id)).length;
      free = total - linked;
    } else {
      // Si pas d'items, on utilise les compteurs si disponibles
      linked = Number.isFinite(data?.linked_count) ? data.linked_count : 0;
      free = Number.isFinite(data?.free_count) ? data.free_count : Math.max(0, total - linked);
    }

    return { items, epcs, total, linked, free };
  }

  function showScanSummary({ total, free, linked }) {
    if (!resultEl) return;
    resultEl.innerHTML = `
      <strong>${total}</strong> tags détectés<br>
      ✔ ${free} libres<br>
      ⚠ ${linked} déjà attribués
    `;
  }

  // -----------------------------
  // Scan
  // -----------------------------
  if (scanBtn) {
    scanBtn.onclick = async () => {
      try {
        if (!resultEl) return;

        setScanLoading(true);
        resultEl.innerText = "Scan en cours…";
        scanData = null;

        const res = await fetch(
          `/api-zenhub/superuser/presentoirs/${PRESENTOIR_ID}/scan-tags`,
          { headers: getTokenHeaders() }
        );

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          resultEl.innerHTML =
            `<span style="color:#b91c1c;">Erreur scan (HTTP ${res.status})</span><br>` +
            `${escapeHtml(txt)}`;
          return;
        }

        const data = await res.json();
        const { items, epcs, total, linked, free } = extractItemsAndEpcsFromScan(data);

        // On garde une forme normalisée pour l’attribution
        scanData = {
          raw: data,
          items,
          epcs,
          total,
          linked,
          free,
        };

        showScanSummary({ total, free, linked });
      } catch (err) {
        console.error("[TAGUER_PRODUITS] scan error", err);
        if (resultEl) {
          resultEl.innerHTML =
            `<span style="color:#b91c1c;">Erreur scan : ${escapeHtml(err?.message)}</span>`;
        }
        scanData = null;
      } finally {
        setScanLoading(false);
      }
    };
  }

  // -----------------------------
  // Assign (bulk)
  // -----------------------------
  if (assignBtn) {
    assignBtn.onclick = async () => {
      try {
        if (!scanData || !Array.isArray(scanData.epcs) || scanData.epcs.length === 0) {
          alert("Aucun tag détecté. Lancez un scan.");
          return;
        }

        const productIdRaw = document.getElementById("product-select")?.value;
        const productId = parseInt(productIdRaw, 10);
        if (!productId || Number.isNaN(productId)) {
          alert("Veuillez choisir un produit");
          return;
        }

        const overwrite = !!document.getElementById("overwrite")?.checked;

        // Avertir si déjà attribués (surtout si overwrite = false)
        const items = Array.isArray(scanData.items) ? scanData.items : [];
        const alreadyLinked = items.filter((i) => !!(i.already_linked || i.linked_display_product_id));

        if (alreadyLinked.length > 0 && !overwrite) {
          const ok = confirm(
            `${alreadyLinked.length} tag(s) sont déjà attribué(s) à un produit.\n` +
              `Ils seront ignorés (car "Remplacer l'attribution existante" n'est pas coché).\n\nContinuer ?`
          );
          if (!ok) return;
        }

        setAssignLoading(true);

        const payload = {
          display_product_id: productId,
          epcs: scanData.epcs,
          overwrite_existing_links: overwrite,
          create_missing_tags: true, // si ton backend le gère (sinon ignoré)
        };

        const res = await fetch(
          `/api-zenhub/superuser/presentoirs/${PRESENTOIR_ID}/assign-product-bulk`,
          {
            method: "POST",
            headers: {
              ...getTokenHeaders(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        const data = await res.json().catch(async () => {
          const txt = await res.text().catch(() => "");
          return { status: "error", detail: txt };
        });

        if (!res.ok) {
          console.error("[TAGUER_PRODUITS] assign error", res.status, data);
          alert(
            `Erreur attribution (HTTP ${res.status})\n` +
              JSON.stringify(data, null, 2)
          );
          return;
        }

        // Affichage robuste (selon ce que renvoie ton backend)
        const assigned = data.assigned ?? data.assigned_epcs ?? 0;
        const overwrittenCount = data.overwritten ?? data.updated_links ?? 0;
        const skipped = data.skipped ?? data.skipped_existing ?? 0;

        alert(
          `Attribution terminée :\n` +
            `${assigned} tags traités\n` +
            `${overwrittenCount} liens remplacés\n` +
            `${skipped} ignorés`
        );

        // Optionnel : relancer un scan pour rafraîchir
        // scanBtn?.click();
      } catch (err) {
        console.error("[TAGUER_PRODUITS] assign error", err);
        alert("Erreur attribution : " + (err?.message || err));
      } finally {
        setAssignLoading(false);
      }
    };
  }
})();
