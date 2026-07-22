// Run with:  node --env-file=.env.local scripts/check-par-rollup.mjs
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT store_id, business_date, net_sales, order_count, labor_minutes
  FROM par_daily_metrics
  ORDER BY store_id, business_date
`;

console.log(`${rows.length} rows total\n`);
for (const r of rows) {
  console.log(`${r.store_id}  ${r.business_date.toISOString().split("T")[0]}  net=$${r.net_sales}  orders=${r.order_count}  laborMin=${r.labor_minutes}`);
}
