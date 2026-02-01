# app/i18n/__init__.py
import json
from pathlib import Path

TRANSLATIONS = {}


def load_translations():
    base = Path(__file__).resolve().parent
    for lang in ["fr", "en"]:
        with open(base / f"{lang}.json", encoding="utf-8") as f:
            TRANSLATIONS[lang] = json.load(f)


def _resolve_lang_and_key(arg1, arg2):
    """
    Autorise les deux syntaxes :
      t(lang, "namespace.key")
      t("namespace.key", lang)
    et essaie de deviner laquelle est utilisée.
    """
    # Langue connue en premier argument → t(lang, "key")
    if isinstance(arg1, str) and arg1 in TRANSLATIONS:
        lang = arg1
        key = arg2
    # Langue connue en second argument → t("key", lang)
    elif isinstance(arg2, str) and arg2 in TRANSLATIONS:
        lang = arg2
        key = arg1
    else:
        # Fallback : on suppose t(lang, key)
        lang = arg1
        key = arg2
    return lang, key


def t(arg1: str, arg2: str, **kwargs) -> str:
    """
    Fonction de traduction tolérante :
      - t(lang, "labo.orders.title")
      - t("labo.orders.title", lang)
    """
    if not TRANSLATIONS:
        load_translations()

    lang, key = _resolve_lang_and_key(arg1, arg2)

    parts = key.split(".")
    data = TRANSLATIONS.get(lang, TRANSLATIONS.get("fr", {}))

    for part in parts:
        if not isinstance(data, dict):
            return key
        data = data.get(part)
        if data is None:
            return key

    # Si un jour tu ajoutes de l’interpolation (kwargs), tu peux le gérer ici.
    return data
