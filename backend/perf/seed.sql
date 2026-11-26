-- Seeds a BENCHMARK database (never the real one) with ~1,000,000 products, 312 categories (3 levels), 300 brands.
-- Usage: docker exec -i shopeasy-bench psql -U postgres -d bench -v ON_ERROR_STOP=1 < perf/seed.sql
\timing on
SET synchronous_commit = off;
SET maintenance_work_mem = '512MB';

TRUNCATE manufacturers, categories, products RESTART IDENTITY CASCADE; -- makes the script re-runnable

INSERT INTO manufacturers (name) SELECT 'Maison ' || lpad(g::text, 3, '0') FROM generate_series(1, 300) g;

-- categories: 12 roots, x5 groups, x4 types = 312 (leaf = "type")
INSERT INTO categories (name, slug) SELECT 'Root ' || g, 'root-' || g FROM generate_series(1, 12) g;
INSERT INTO categories (name, slug, parent_id)
  SELECT p.name || ' / Group ' || k, p.slug || '-g' || k, p.id FROM categories p CROSS JOIN generate_series(1, 5) k WHERE p.parent_id IS NULL;
INSERT INTO categories (name, slug, parent_id)
  SELECT p.name || ' / Type ' || k, p.slug || '-t' || k, p.id FROM categories p CROSS JOIN generate_series(1, 4) k
  WHERE p.parent_id IS NOT NULL AND p.slug ~ '-g[0-9]+$';

WITH w AS (
  SELECT ARRAY['Classic','Modern','Rustic','Elegant','Compact','Heritage','Artisan','Minimal','Vintage','Nordic','Coastal','Urban',
               'Studio','Handmade','Everyday','Signature','Limited','Essential','Refined','Bold','Soft','Warm','Cool','Natural','Polished',
               'Matte','Woven','Carved','Forged','Folded','Stacked','Layered','Tapered','Rounded','Slim','Grand'] AS adj,
         ARRAY['Walnut','Oak','Maple','Brass','Copper','Linen','Wool','Leather','Marble','Ceramic','Glass','Steel','Bamboo','Cotton',
               'Velvet','Pine','Ash','Cherry','Teak','Bronze','Silk','Jute','Rattan','Stone','Concrete','Porcelain','Felt','Suede','Cedar','Birch'] AS mat,
         ARRAY['Stool','Lamp','Chair','Table','Vase','Bowl','Throw','Rug','Mirror','Shelf','Clock','Candle','Basket','Tray','Cushion','Blanket',
               'Bench','Desk','Cabinet','Sofa','Ottoman','Planter','Frame','Hook','Rack','Kettle','Mug','Plate','Jug','Pitcher','Carafe','Tumbler',
               'Coaster','Napkin','Apron','Towel','Robe','Slipper','Scarf','Hat','Bag','Wallet','Belt','Watch','Pen','Notebook','Diary','Folder',
               'Stand','Holder','Box','Case','Crate','Chest','Trunk','Pouch','Satchel','Tote','Duffel','Trivet'] AS noun)
INSERT INTO products (sku, name, slug, description, price, manufacturer_id, is_active, created_at, updated_at)
SELECT 'SKU-' || g,
       adj[1 + (g * 7) % 36] || ' ' || mat[1 + (g * 13) % 30] || ' ' || noun[1 + (g * 31) % 60] || ' ' || g,
       lower(adj[1 + (g * 7) % 36] || '-' || mat[1 + (g * 13) % 30] || '-' || noun[1 + (g * 31) % 60]) || '-' || g,
       CASE WHEN g % 5 < 2 THEN 'Premium ' ELSE '' END || 'A ' || lower(adj[1 + (g * 7) % 36]) || ' ' || lower(noun[1 + (g * 31) % 60])
         || ' made from ' || lower(mat[1 + (g * 13) % 30]) || '. ' || repeat('Crafted with care. ', (1 + g % 3)::int),
       round((10 + random() * 990)::numeric, 2),
       1 + (g * 7919) % 300,
       random() < 0.98,
       now() - random() * interval '730 days',
       now()
FROM w, generate_series(1::bigint, 1000000::bigint) g; -- bigint: g * 7919 overflows a 32-bit integer

INSERT INTO inventory (product_id, quantity_on_hand)
  SELECT id, CASE WHEN random() < 0.10 THEN 0 ELSE (random() * 200)::int END FROM products;

WITH leaves AS (SELECT array_agg(id ORDER BY id) AS ids FROM categories WHERE slug ~ '-t[0-9]+$')
INSERT INTO product_categories (product_id, category_id)
  SELECT p.id, leaves.ids[1 + (p.id % 240)::int] FROM products p, leaves
  UNION
  SELECT p.id, leaves.ids[1 + ((p.id * 31) % 240)::int] FROM products p, leaves WHERE p.id % 5 < 2;

INSERT INTO product_images (product_id, url, position)
  SELECT id, 'https://cdn.example.test/img/' || id || '.webp', 0 FROM products;

ANALYZE;
SELECT 'products' AS t, count(*) FROM products UNION ALL SELECT 'inventory', count(*) FROM inventory
UNION ALL SELECT 'product_categories', count(*) FROM product_categories UNION ALL SELECT 'product_images', count(*) FROM product_images;
SELECT pg_size_pretty(pg_database_size('bench')) AS database_size;
