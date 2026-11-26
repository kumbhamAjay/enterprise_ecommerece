-- Schema snapshot of the Supabase Postgres DB (users / roles / addresses).
-- Idempotent: safe to re-run. Extend as new modules are added.

CREATE TABLE IF NOT EXISTS roles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        varchar(50) NOT NULL UNIQUE,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name    varchar(100) NOT NULL,
  last_name     varchar(100),
  email         varchar(255) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS addresses (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id),
  address_line1 text NOT NULL,
  city          varchar(100) NOT NULL,
  state         varchar(100),
  postal_code   varchar(20),
  country       varchar(100) NOT NULL,
  is_default    boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO roles (name, description) VALUES
  ('CUSTOMER',    'Regular customer'),
  ('ADMIN',       'Application administrator'),
  ('SUPER_ADMIN', 'Full system access')
ON CONFLICT (name) DO NOTHING;

-- Refresh tokens: only the SHA-256 hash is stored, never the token itself.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,            -- UNIQUE also gives the lookup index
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- Email verification + password reset share one table (type column), hash only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS one_time_tokens (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('EMAIL_VERIFY', 'PASSWORD_RESET')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz DEFAULT now()
);

-- At most one default address per user, enforced by the DB (safe under concurrent requests).
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default ON addresses (user_id) WHERE is_default;

-- ================= Module 2: catalog =================
CREATE TABLE IF NOT EXISTS manufacturers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       varchar(150) NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       varchar(150) NOT NULL UNIQUE,
  slug       varchar(160) NOT NULL UNIQUE,
  parent_id  bigint REFERENCES categories(id),   -- RESTRICT: can't delete a category that has children
  created_at timestamptz DEFAULT now(),
  CHECK (parent_id <> id)
);

CREATE TABLE IF NOT EXISTS products (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku             varchar(64)  NOT NULL UNIQUE,
  name            varchar(255) NOT NULL,
  slug            varchar(300) NOT NULL UNIQUE,
  description     text,
  price           numeric(12,2) NOT NULL CHECK (price >= 0),   -- never float for money
  manufacturer_id bigint REFERENCES manufacturers(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,               -- soft delete: orders will reference products
  external_id     text UNIQUE,                                 -- e.g. 'dummyjson:12', makes imports idempotent (UPSERT key)
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  search_vector   tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED
);
CREATE INDEX IF NOT EXISTS products_search_idx       ON products USING gin (search_vector);
CREATE INDEX IF NOT EXISTS products_active_price_idx ON products (price) WHERE is_active;
CREATE INDEX IF NOT EXISTS products_newest_idx       ON products (created_at DESC, id DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS products_manufacturer_idx ON products (manufacturer_id);

CREATE TABLE IF NOT EXISTS product_categories (        -- many-to-many
  product_id  bigint NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX IF NOT EXISTS product_categories_category_idx ON product_categories (category_id);

CREATE TABLE IF NOT EXISTS product_images (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        text NOT NULL,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id);

-- ================= Module 3: inventory =================
-- One row per product. available = quantity_on_hand - reserved_quantity.
CREATE TABLE IF NOT EXISTS inventory (
  product_id          bigint PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity_on_hand    int NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  reserved_quantity   int NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  low_stock_threshold int NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  updated_at          timestamptz DEFAULT now(),
  CHECK (reserved_quantity <= quantity_on_hand)   -- last line of defence: the database itself refuses to oversell
);

-- A hold on stock (cart/checkout). ACTIVE -> CONFIRMED (sold) | RELEASED (cancelled) | EXPIRED (timed out).
CREATE TABLE IF NOT EXISTS stock_reservations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  quantity    int NOT NULL CHECK (quantity > 0),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS stock_reservations_expiry_idx  ON stock_reservations (expires_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS stock_reservations_user_idx    ON stock_reservations (user_id);
CREATE INDEX IF NOT EXISTS stock_reservations_product_idx ON stock_reservations (product_id);

-- Append-only ledger of every stock movement (inventory history).
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('INITIAL','RESTOCK','CORRECTION','DAMAGED','RETURN','RESERVE','RELEASE','EXPIRE','SALE')),
  quantity_delta int NOT NULL DEFAULT 0,        -- change in quantity_on_hand
  reserved_delta int NOT NULL DEFAULT 0,        -- change in reserved_quantity
  on_hand_after  int NOT NULL,
  reserved_after int NOT NULL,
  reservation_id bigint REFERENCES stock_reservations(id) ON DELETE SET NULL,
  actor_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,   -- NULL = system (e.g. expiry job)
  note           text,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_transactions_product_idx ON inventory_transactions (product_id, created_at DESC, id DESC);

-- Every existing product gets an inventory row (0 stock until someone stocks it).
INSERT INTO inventory (product_id) SELECT id FROM products ON CONFLICT DO NOTHING;

-- ================= Module 4: cart =================
-- One persistent cart per signed-in user. Guest carts live in the browser and are merged on login.
CREATE TABLE IF NOT EXISTS carts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,   -- UNIQUE: get-or-create is race-free
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- No price stored: the cart always shows the live price (the order will snapshot it at checkout).
CREATE TABLE IF NOT EXISTS cart_items (
  cart_id    bigint NOT NULL REFERENCES carts(id)    ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   int NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  added_at   timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (cart_id, product_id)                                            -- one line per product
);
CREATE INDEX IF NOT EXISTS cart_items_product_idx ON cart_items (product_id);

-- ================= Module 5: checkout & orders =================
CREATE TABLE IF NOT EXISTS orders (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number       text NOT NULL UNIQUE,                       -- human-facing, random (not guessable from the id)
  user_id            bigint REFERENCES users(id) ON DELETE SET NULL,   -- order history outlives an account
  customer_email     varchar(255) NOT NULL,                      -- snapshot
  status             text NOT NULL DEFAULT 'PENDING_PAYMENT'
                     CHECK (status IN ('PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','DELIVERED','CANCELLED','REFUNDED')),
  subtotal           numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  shipping           numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  tax                numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total              numeric(12,2) NOT NULL CHECK (total >= 0),
  currency           char(3) NOT NULL DEFAULT 'USD',
  shipping_address   jsonb NOT NULL,                             -- snapshots: saved addresses can change or be deleted later
  billing_address    jsonb NOT NULL,
  payment_expires_at timestamptz,                                -- when the stock hold (and the order) lapses if unpaid
  placed_at          timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  updated_at         timestamptz DEFAULT now(),
  CHECK (total = subtotal + shipping + tax)                      -- the books must add up, enforced by the database
);
CREATE INDEX IF NOT EXISTS orders_user_idx   ON orders (user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_expiry_idx ON orders (payment_expires_at) WHERE status = 'PENDING_PAYMENT';

-- Lines are snapshots: later price or name changes never rewrite history.
CREATE TABLE IF NOT EXISTS order_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     bigint REFERENCES products(id) ON DELETE SET NULL,
  reservation_id bigint REFERENCES stock_reservations(id) ON DELETE SET NULL,
  sku            text NOT NULL,
  name           text NOT NULL,
  unit_price     numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity       int NOT NULL CHECK (quantity > 0),
  line_total     numeric(12,2) NOT NULL CHECK (line_total = unit_price * quantity)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS order_status_history (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status   text,
  to_status     text NOT NULL,
  actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system
  note          text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history (order_id, id);

-- Checkout idempotency: the same (user, key) can create at most one order, however many times it is sent.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL,
  request_hash text NOT NULL,                                    -- same key + different body = client bug (422)
  order_id     bigint REFERENCES orders(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ================= Module 6: payments (Stripe) =================
-- We never store card data: the browser sends it straight to Stripe. We keep only references and amounts.
CREATE TABLE IF NOT EXISTS payments (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider           text NOT NULL DEFAULT 'stripe',
  provider_intent_id text NOT NULL UNIQUE,                       -- Stripe PaymentIntent id (pi_...)
  attempt            int  NOT NULL DEFAULT 1,
  amount_cents       int  NOT NULL CHECK (amount_cents > 0),
  currency           char(3) NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELED')),
  applied_to_order   boolean NOT NULL DEFAULT false,             -- false on SUCCEEDED = money taken but order not fulfilled -> must be refunded
  refunded_cents     int  NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  last_error         text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  succeeded_at       timestamptz
);
CREATE INDEX IF NOT EXISTS payments_order_idx   ON payments (order_id);
CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments (created_at) WHERE status = 'PENDING';

-- Refund outbox: the intent to refund is recorded in the SAME transaction as the business change, then executed
-- (and retried) separately, so a crash between "decide" and "call Stripe" can never lose a refund.
CREATE TABLE IF NOT EXISTS refunds (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id         bigint NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id           bigint NOT NULL REFERENCES orders(id)   ON DELETE CASCADE,
  amount_cents       int  NOT NULL CHECK (amount_cents > 0),
  reason             text NOT NULL CHECK (reason IN ('ORDER_REFUND','LATE_PAYMENT')),
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  provider_refund_id text,
  attempts           int  NOT NULL DEFAULT 0,
  last_error         text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  UNIQUE (payment_id, reason)                                    -- queueing the same refund twice is a no-op
);
CREATE INDEX IF NOT EXISTS refunds_pending_idx ON refunds (created_at) WHERE status = 'PENDING';

-- Webhook de-duplication: Stripe delivers at-least-once, so the same event id can arrive many times.
CREATE TABLE IF NOT EXISTS stripe_events (
  id          text PRIMARY KEY,                                  -- evt_...
  type        text NOT NULL,
  object_id   text,
  received_at timestamptz DEFAULT now()
);

-- Uploaded images remember their Cloudinary public_id so deleting an image also deletes the stored file.
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS public_id text;
