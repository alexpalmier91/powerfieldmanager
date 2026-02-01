# Ré-exports pour compat avec l'ancien `app/schemas.py`

from .base import (
    LaboSignupIn,
    EmailIn,
    CodeLoginIn,
    Msg,        # requis par sync_presta / imports
    MsgOut,     # requis par auth
    TokenOut,
    ImportStatus,
)

# Schémas Superuser (si présents)
try:
    from .superuser import (
        PendingItem, PendingResponse,
        ApproveRequest, LinkRequest, UnlinkRequest,
        ImportClientsResult,
    )
except Exception:
    PendingItem = PendingResponse = ApproveRequest = LinkRequest = UnlinkRequest = ImportClientsResult = None  # type: ignore

# Schémas Orders (si présents)
try:
    from .orders import (
        OrderIn, OrderOut, OrderItemOut, OrderItemIn, OrderStatusPatch,
    )
except Exception:
    OrderIn = OrderOut = OrderItemOut = OrderItemIn = OrderStatusPatch = None  # type: ignore

# Schémas Products (si présents)
try:
    from .products import (
        ProductOut, VariantOut, CategoryOut,
    )
except Exception:
    ProductOut = VariantOut = CategoryOut = None  # type: ignore


# ✅ Fusion finale de tous les exports
__all__ = [
    # base
    "LaboSignupIn", "EmailIn", "CodeLoginIn",
    "Msg", "MsgOut", "TokenOut",
    "ImportStatus",
    # superuser
    "PendingItem", "PendingResponse",
    "ApproveRequest", "LinkRequest", "UnlinkRequest",
    "ImportClientsResult",
    # orders
    "OrderIn", "OrderOut", "OrderItemOut", "OrderItemIn", "OrderStatusPatch",
    # products
    "ProductOut", "VariantOut", "CategoryOut",
]
