# app/services/labo_pdf.py
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

try:
    from weasyprint import HTML
except ImportError as exc:
    raise RuntimeError(
        "WeasyPrint n'est pas installé. Installe-le avec `pip install weasyprint`."
    ) from exc

# Dossier static (pour accéder au logo en file://)
STATIC_DIR = Path("app/static").resolve()


def _safe(v: Any) -> str:
    if v is None:
        return ""
    return str(v)


def _fmt_date_fr(d: Any) -> str:
    """
    Format JJ/MM/AAAA pour date/datetime/str.
    """
    if d is None:
        return ""
    try:
        if hasattr(d, "strftime"):
            return d.strftime("%d/%m/%Y")
    except Exception:
        pass

    s = str(d)
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            y, m, dd = s[:10].split("-")
            return f"{dd}/{m}/{y}"
        except Exception:
            return s
    return s


def _file_url_from_static_rel(rel_path: str | None) -> str | None:
    """
    Convertit un chemin relatif sous app/static (ex: 'uploads/labos/12/logo.png')
    en URL file://... utilisable par WeasyPrint.
    Sécurise pour éviter de sortir du dossier static.
    """
    if not rel_path:
        return None
    p = (STATIC_DIR / rel_path).resolve()
    if not str(p).startswith(str(STATIC_DIR)):
        return None
    if not p.exists():
        return None
    return p.as_uri()


def _commercial_document_html(ctx: Dict[str, Any]) -> str:
    """
    Génère le HTML d'un document commercial (Facture / Bon de commande)
    en réutilisant une seule mise en page.
    """
    doc = ctx.get("doc")
    client = ctx.get("client")
    labo = ctx.get("labo")
    delivery = ctx.get("delivery") or client
    items: List[Dict[str, Any]] = ctx.get("items") or []

    doc_title = (ctx.get("doc_title") or "Document").strip()
    doc_number = _safe(ctx.get("doc_number") or getattr(doc, "order_number", getattr(doc, "id", "")))

    # ✅ agent_name (optionnel)
    agent_name = _safe(ctx.get("agent_name") or "")

    order_date_raw = ctx.get("order_date") or getattr(doc, "order_date", None) or getattr(doc, "created_at", None)
    delivery_date_raw = ctx.get("delivery_date") or getattr(doc, "delivery_date", None)

    order_date = _fmt_date_fr(order_date_raw)
    delivery_date = _fmt_date_fr(delivery_date_raw)

    currency = _safe(ctx.get("currency") or getattr(doc, "currency", "EUR") or "EUR")

    # ----- LABO -----
    labo_name = _safe(getattr(labo, "legal_name", None) or getattr(labo, "name", ""))
    labo_addr1 = _safe(getattr(labo, "address1", ""))
    labo_addr2 = _safe(getattr(labo, "address2", ""))
    labo_zip = _safe(getattr(labo, "zip", None) or getattr(labo, "postcode", ""))
    labo_city = _safe(getattr(labo, "city", ""))
    labo_country = _safe(getattr(labo, "country", ""))

    labo_siret = _safe(getattr(labo, "siret", ""))
    labo_vat = _safe(getattr(labo, "vat_number", ""))
    labo_email = _safe(getattr(labo, "email", ""))
    labo_phone = _safe(getattr(labo, "phone", ""))

    invoice_footer = _safe(getattr(labo, "invoice_footer", ""))

    logo_rel = getattr(labo, "logo_path", None)
    logo_url = _file_url_from_static_rel(logo_rel)

    # ----- CLIENT (facturation) -----
    client_name = _safe(getattr(client, "company_name", getattr(client, "name", "")))
    client_addr1 = _safe(getattr(client, "address1", ""))
    client_addr2 = _safe(getattr(client, "address2", ""))
    client_zip = _safe(getattr(client, "postcode", ""))
    client_city = _safe(getattr(client, "city", ""))

    # ----- DELIVERY (livraison) -----
    delivery_name = _safe(getattr(delivery, "company_name", getattr(delivery, "name", "")))
    delivery_addr1 = _safe(getattr(delivery, "address1", ""))
    delivery_addr2 = _safe(getattr(delivery, "address2", ""))
    delivery_zip = _safe(getattr(delivery, "postcode", ""))
    delivery_city = _safe(getattr(delivery, "city", ""))

    # Lignes + totaux
    rows_html = []
    total_ht_sum = 0.0
    total_tva_sum = 0.0
    total_ttc_sum = 0.0

    for it in items:
        sku = _safe(it.get("sku"))
        pname = _safe(it.get("product_name"))
        qty = _safe(it.get("qty"))

        unit_ht_val = float(it.get("unit_ht", 0) or 0)
        total_ht_val = float(it.get("total_ht", 0) or 0)

        vat_rate_val = float(it.get("vat_rate", 0) or 0)  # taux TVA (%)
        total_tva_val = total_ht_val * (vat_rate_val / 100.0)
        total_ttc_val = total_ht_val + total_tva_val

        total_ht_sum += total_ht_val
        total_tva_sum += total_tva_val
        total_ttc_sum += total_ttc_val

        unit_ht = f"{unit_ht_val:0.2f}"
        total_line_ht = f"{total_ht_val:0.2f}"
        vat_rate = f"{vat_rate_val:0.2f}".rstrip("0").rstrip(".")
        total_line_ttc = f"{total_ttc_val:0.2f}"

        rows_html.append(
            f"""
            <tr>
              <td>{sku}</td>
              <td>{pname}</td>
              <td class="num">{qty}</td>
              <td class="num">{unit_ht}</td>
              <td class="num">{vat_rate}%</td>
              <td class="num">{total_line_ht}</td>
              <td class="num">{total_line_ttc}</td>
            </tr>
            """
        )

    rows_block = "\n".join(rows_html) or """
        <tr>
          <td colspan="7" class="empty">Aucun article</td>
        </tr>
    """

    logo_block = ""
    if logo_url:
        logo_block = f"""
          <div class="labo-logo">
            <img src="{logo_url}" alt="logo">
          </div>
        """

    mentions_parts = []
    if labo_siret:
        mentions_parts.append(f"SIRET : {labo_siret}")
    if labo_vat:
        mentions_parts.append(f"TVA : {labo_vat}")
    if labo_email:
        mentions_parts.append(labo_email)
    if labo_phone:
        mentions_parts.append(labo_phone)
    labo_mentions = " • ".join([p for p in mentions_parts if p])

    labo_full_address_parts = [
        p
        for p in [
            labo_addr1,
            labo_addr2,
            f"{labo_zip} {labo_city}".strip(),
            labo_country,
        ]
        if p and str(p).strip()
    ]
    labo_full_address = " • ".join(labo_full_address_parts)

    footer_infos_parts = []
    if labo_name:
        footer_infos_parts.append(labo_name)
    if labo_full_address:
        footer_infos_parts.append(labo_full_address)
    if labo_siret:
        footer_infos_parts.append(f"SIRET : {labo_siret}")
    if labo_vat:
        footer_infos_parts.append(f"TVA intracommunautaire : {labo_vat}")
    labo_footer_infos = " | ".join([p for p in footer_infos_parts if p])

    footer_block = ""
    if invoice_footer.strip():
        footer_block = f"""
          <div class="footer-note">
            {invoice_footer}
          </div>
        """

    # ✅ bloc agent sous le numéro
    agent_block = ""
    if agent_name.strip():
        agent_block = f'Agent : <strong>{agent_name}</strong><br>'

    html = f"""
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>{doc_title} {doc_number}</title>
  <style>
    @page {{
      size: A4;
      margin: 20mm 15mm 22mm 15mm;

      @bottom-left {{
        content: element(page_footer);
      }}
    }}

    body {{
      font-family: sans-serif;
      font-size: 11px;
      color: #333;
    }}

    h1 {{
      font-size: 18px;
      margin: 0 0 10px 0;
    }}

    .header {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 15px;
      align-items: flex-start;
    }}

    .header-left {{
      flex: 1;
      min-width: 240px;
    }}

    .header-right {{
      width: 260px;
    }}

    .labo-logo {{
      margin-bottom: 8px;
      text-align: right;
    }}

    .labo-logo img {{
      max-height: 90px;
      max-width: 220px;
      object-fit: contain;
    }}

    .box {{
      border: 1px solid #999;
      padding: 6px 8px;
      margin-bottom: 8px;
    }}

    .box h2 {{
      font-size: 12px;
      margin: 0 0 4px 0;
    }}

    .small {{
      font-size: 10px;
    }}

    .muted {{
      color: #666;
    }}

    .addr-row {{
      display: flex;
      gap: 12px;
      align-items: stretch;
      margin-bottom: 8px;
    }}

    .addr-col {{
      flex: 1;
      margin-bottom: 0;
    }}

    table.items {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      table-layout: fixed;
    }}

    table.items th,
    table.items td {{
      border: 1px solid #999;
      padding: 4px 5px;
    }}

    table.items th {{
      background: #f3f3f3;
      font-size: 10px;
    }}

    table.items td:nth-child(2) {{
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }}

    table.items td:first-child {{
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}

    td.num {{
      text-align: right;
      white-space: nowrap;
    }}

    td.empty {{
      text-align: center;
      font-style: italic;
      color: #777;
    }}

    .totals {{
      margin-top: 8px;
      text-align: right;
      font-weight: bold;
      line-height: 1.4;
    }}

    .footer-note {{
      margin-top: 14px;
      font-size: 10px;
      color: #555;
      border-top: 1px solid #ddd;
      padding-top: 8px;
      white-space: pre-wrap;
    }}

    .page-footer {{
      position: running(page_footer);
      font-size: 9px;
      color: #555;
      border-top: 1px solid #ddd;
      padding-top: 6px;
    }}

    .page-break {{
      page-break-after: always;
    }}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>{doc_title}</h1>
      <p>
        N° <strong>{doc_number}</strong><br>
        {agent_block}
        Date de commande : <strong>{order_date or "-"}</strong><br>
        Date de livraison : <strong>{delivery_date or "-"}</strong>
      </p>
    </div>

    <div class="header-right">
      {logo_block}
      <div class="box small">
        <strong>{labo_name}</strong><br>
        {labo_addr1}<br>
        {labo_addr2}<br>
        {labo_zip} {labo_city}<br>
        {labo_country}<br>
        <span class="muted">{labo_mentions}</span>
      </div>
    </div>
  </div>

  <div class="addr-row">
    <div class="box small addr-col">
      <h2>Adresse de livraison</h2>
      <strong>{delivery_name}</strong><br>
      {delivery_addr1}<br>
      {delivery_addr2}<br>
      {delivery_zip} {delivery_city}
    </div>

    <div class="box small addr-col">
      <h2>Adresse de facturation</h2>
      <strong>{client_name}</strong><br>
      {client_addr1}<br>
      {client_addr2}<br>
      {client_zip} {client_city}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width: 20%;">Réf.</th>
        <th>Produit</th>
        <th style="width: 6%;">Qté</th>
        <th style="width: 8%;">PU HT ({currency})</th>
        <th style="width: 8%;">TVA</th>
        <th style="width: 8%;">Total HT ({currency})</th>
        <th style="width: 12%;">Total TTC ({currency})</th>
      </tr>
    </thead>
    <tbody>
      {rows_block}
    </tbody>
  </table>

  <div class="totals">
    <div>Total HT : {total_ht_sum:0.2f} {currency}</div>
    <div>Total TVA : {total_tva_sum:0.2f} {currency}</div>
    <div>Total TTC : {total_ttc_sum:0.2f} {currency}</div>
  </div>

  {footer_block}

  <div class="page-footer">
    {labo_footer_infos}
  </div>
</body>
</html>
"""
    return html


def render_commercial_document_pdf(
    *,
    doc_title: str,
    doc_number: str,
    order_date: Any,
    delivery_date: Any,
    currency: str,
    items: Iterable[Dict[str, Any]],
    client: Any,
    labo: Any,
    delivery: Any,
    doc: Any = None,
    agent_name: Optional[str] = None,  # ✅
) -> bytes:
    ctx = {
        "doc": doc,
        "doc_title": doc_title,
        "doc_number": doc_number,
        "order_date": order_date,
        "delivery_date": delivery_date,
        "currency": currency,
        "items": list(items),
        "client": client,
        "labo": labo,
        "delivery": delivery,
        "agent_name": agent_name or "",
    }
    html = _commercial_document_html(ctx)
    buf = BytesIO()
    HTML(string=html).write_pdf(buf)
    return buf.getvalue()


# --------------------------------------------------------------------
# Wrappers existants (facture labo) + bon de commande agent
# --------------------------------------------------------------------

def render_labo_invoice_pdf(
    *,
    doc: Any,
    items: Iterable[Dict[str, Any]],
    client: Any,
    labo: Any,
    delivery: Any,
) -> bytes:
    number = _safe(getattr(doc, "order_number", getattr(doc, "id", "")))
    order_date = getattr(doc, "order_date", None) or getattr(doc, "created_at", None)
    delivery_date = getattr(doc, "delivery_date", None)
    currency = getattr(doc, "currency", "EUR") or "EUR"

    return render_commercial_document_pdf(
        doc_title="Facture",
        doc_number=number,
        order_date=order_date,
        delivery_date=delivery_date,
        currency=currency,
        items=items,
        client=client,
        labo=labo,
        delivery=delivery,
        doc=doc,
        agent_name=None,
    )


def render_agent_order_pdf(
    *,
    doc: Any,
    items: Iterable[Dict[str, Any]],
    client: Any,
    labo: Any,
    delivery: Any,
    agent_name: Optional[str] = None,  # ✅
) -> bytes:
    number = _safe(getattr(doc, "order_number", getattr(doc, "id", "")))
    order_date = getattr(doc, "order_date", None) or getattr(doc, "created_at", None)
    delivery_date = getattr(doc, "delivery_date", None)
    currency = getattr(doc, "currency", "EUR") or "EUR"

    return render_commercial_document_pdf(
        doc_title="Bon de commande",
        doc_number=number,
        order_date=order_date,
        delivery_date=delivery_date,
        currency=currency,
        items=items,
        client=client,
        labo=labo,
        delivery=delivery,
        doc=doc,
        agent_name=agent_name,
    )


# --------------------------------------------------------------------
# ✅ Nouveau: bulk générique "même modèle" avec doc_title par contexte
# --------------------------------------------------------------------

def render_commercial_documents_bulk_pdf(contexts: Iterable[Dict[str, Any]]) -> bytes:
    """
    Génère un PDF multi-pages, une page par context.
    Chaque context peut contenir:
      - doc, doc_title, doc_number, order_date, delivery_date, currency,
      - items, client, labo, delivery,
      - agent_name (optionnel)
    """
    ctx_list = list(contexts or [])
    if not ctx_list:
        # PDF vide (page avec "Aucun document")
        html = _commercial_document_html({"doc_title": "Document", "doc_number": "", "items": []})
        return HTML(string=html).write_pdf()

    # On génère le HTML complet de la 1ère page pour récupérer <head> + styles
    first_html = _commercial_document_html(ctx_list[0])

    # Si une seule page
    if len(ctx_list) == 1:
        return HTML(string=first_html).write_pdf()

    # Multi pages : on garde head + body de la première,
    # puis on injecte le contenu <body> des suivantes avec page-break
    parts: List[str] = []

    marker_end = "</body>"
    if marker_end in first_html:
        head_and_body_start = first_html.split(marker_end, 1)[0]
        parts.append(head_and_body_start)
    else:
        parts.append(first_html)

    for ctx in ctx_list[1:]:
        html = _commercial_document_html(ctx)
        body_inner = html
        if "<body>" in html and "</body>" in html:
            body_inner = html.split("<body>", 1)[1].split("</body>", 1)[0]
        parts.append(f'<div class="page-break"></div>{body_inner}')

    final_html = "".join(parts) + "</body></html>"

    buf = BytesIO()
    HTML(string=final_html).write_pdf(buf)
    return buf.getvalue()


# --------------------------------------------------------------------
# Ancien bulk factures labo (si tu l’utilises encore ailleurs)
# --------------------------------------------------------------------

def render_labo_invoices_bulk_pdf(contexts: Iterable[Dict[str, Any]]) -> bytes:
    """
    Compat: conserve ta fonction existante, mais garde l'ancien comportement:
    "Facture" forcé.
    """
    parts: List[str] = []
    ctx_list = list(contexts)

    for i, ctx in enumerate(ctx_list):
        doc = ctx.get("doc")
        items = ctx.get("items", [])
        client = ctx.get("client")
        labo = ctx.get("labo")
        delivery = ctx.get("delivery") or client

        number = _safe(getattr(doc, "order_number", getattr(doc, "id", "")))
        order_date = getattr(doc, "order_date", None) or getattr(doc, "created_at", None)
        delivery_date = getattr(doc, "delivery_date", None)
        currency = getattr(doc, "currency", "EUR") or "EUR"

        html = _commercial_document_html(
            {
                "doc": doc,
                "doc_title": "Facture",
                "doc_number": number,
                "order_date": order_date,
                "delivery_date": delivery_date,
                "currency": currency,
                "items": list(items),
                "client": client,
                "labo": labo,
                "delivery": delivery,
                "agent_name": "",
            }
        )

        if i == 0:
            if len(ctx_list) == 1:
                return HTML(string=html).write_pdf()

            marker = "</body>"
            if marker in html:
                body, _ = html.split(marker, 1)
                parts.append(body)
            else:
                parts.append(html)
        else:
            marker_start = "<body>"
            marker_end = "</body>"
            inner = html
            if marker_start in html and marker_end in html:
                inner = html.split(marker_start, 1)[1].split(marker_end, 1)[0]
            parts.append(f'<div class="page-break"></div>{inner}')

    final_html = "".join(parts) + "</body></html>"

    buf = BytesIO()
    HTML(string=final_html).write_pdf(buf)
    return buf.getvalue()
