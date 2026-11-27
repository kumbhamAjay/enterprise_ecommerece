export type Manufacturer = { id: string; name: string };
export type Category = { id: string; name: string; slug: string; parentId: string | null };

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export type ProductSummary = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  price: string; // numeric(12,2) arrives as a string
  manufacturer: Manufacturer | null;
  imageUrl: string | null;
  stockStatus: StockStatus;
  stockLeft: number | null; // exact count only when stock is low
};

export type ProductDetail = Omit<ProductSummary, "imageUrl"> & {
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  categories: { id: string; name: string; slug: string }[];
  images: { id: string; url: string; position: number }[];
};

export type PageMeta = { page: number; limit: number; total: number; totalPages: number };
export type Page<T> = { data: T[]; meta: PageMeta };
// Product lists: exact total up to 10,000 (then totalCapped), cursor for the next page, total is null on cursor pages
export type FeedMeta = { limit: number; total: number | null; totalPages: number | null; totalCapped: boolean; hasMore: boolean; nextCursor: string | null; sortedBy: string };
export type Feed<T> = { data: T[]; meta: FeedMeta };

export type User = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  emailVerified: boolean;
  roles: string[];
};

export type Address = {
  id: string;
  addressLine1: string;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
};

export type ProductQuery = {
  q?: string;
  categoryId?: string;
  manufacturerId?: string;
  minPrice?: string;
  maxPrice?: string;
  inStock?: string;
  sort?: string;
  page?: number;
  limit?: number;
  cursor?: string;
};

export type InventoryItem = {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  quantityOnHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  status: StockStatus;
  updatedAt: string;
};

export type LedgerEntry = {
  id: string;
  type: "INITIAL" | "RESTOCK" | "CORRECTION" | "DAMAGED" | "RETURN" | "RESERVE" | "RELEASE" | "EXPIRE" | "SALE";
  quantityDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  reservationId: string | null;
  note: string | null;
  createdAt: string;
  actorName: string | null;
};

export type CartIssue = "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";
export type CartLine = {
  productId: string;
  name: string;
  sku: string;
  slug: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  isActive: boolean;
  available: number;
  issues: CartIssue[];
};
export type CartView = { items: CartLine[]; itemCount: number; subtotal: string; currency: string; hasIssues: boolean };

export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
export type OrderAddress = { fullName: string; line1: string; line2?: string; city: string; state?: string; postalCode?: string; country: string; phone?: string };
export type OrderItem = { productId: string | null; sku: string; name: string; unitPrice: string; quantity: number; lineTotal: string; imageUrl: string | null };
export type OrderEvent = { fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string; actor: string | null };
export type PaymentInfo = {
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  amountCents: number;
  currency: string;
  refundedCents: number;
  appliedToOrder: boolean;
  lastError: string | null;
  createdAt: string;
  refunds: { status: "PENDING" | "SUCCEEDED" | "FAILED"; amountCents: number; reason: "ORDER_REFUND" | "LATE_PAYMENT" }[];
};

export type Order = {
  id: string;
  orderNumber: string;
  userId: string | null;
  customerEmail: string;
  status: OrderStatus;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  currency: string;
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  paymentExpiresAt: string | null;
  placedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: OrderItem[];
  history: OrderEvent[];
  payments: PaymentInfo[];
};
export type OrderListItem = { id: string; orderNumber: string; customerEmail: string; status: OrderStatus; total: string; currency: string; placedAt: string; itemCount: number; thumbs: string[] };
export type CheckoutPreview = CartView & { subtotal: string; shipping: string; tax: string; total: string; amountToFreeShipping: string };

export type EmailStatus = "PENDING" | "SENT" | "FAILED";
export type EmailRow = { id: string; template: string; to: string; status: EmailStatus; attempts: number; lastError: string | null; priority: number; createdAt: string; sentAt: string | null };
export type EmailStats = {
  emails: Record<EmailStatus, number>;
  queue: { waiting: number; active: number; delayed: number; failed: number; completed: number } | null;
  mode: "queue" | "inline";
  provider: string;
};

// ---- analytics and user administration (admin) ----
export type Kpi = { value: number; previous: number; changePct: number | null };
export type Summary = {
  range: { from: string; to: string };
  revenue: Kpi; orders: Kpi; avgOrderValue: Kpi; buyers: number; newCustomers: number;
  refunded: { orders: number; total: number };
  ordersByStatus: { status: string; orders: number; total: number }[];
};
export type RevenuePoint = { bucket: string; orders: number; revenue: number; cumulative: number; growthPct: number | null };
export type TopProduct = { rank: number; sku: string; name: string; productId: string | null; units: number; orders: number; revenue: number; sharePct: number };
export type TopCustomer = { userId: string; email: string; orders: number; spend: number; avgOrder: number; lastOrderAt: string };
export type AdminUser = {
  id: string; firstName: string; lastName: string | null; email: string; isActive: boolean; emailVerified: boolean;
  createdAt: string; roles: string[]; orders: number; spend: number;
};
export type AdminUserDetail = Omit<AdminUser, "orders" | "spend"> & {
  recentOrders: { id: string; orderNumber: string; status: string; total: number; placedAt: string }[];
  audit: { action: string; detail: Record<string, unknown> | null; createdAt: string; actorEmail: string | null }[];
};
