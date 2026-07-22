// Run with:  node --env-file=.env.local scripts/debug-par-orders.mjs
// Raw GetOrders call for one store/day, no caching, no swallowed errors — prints
// the full SOAP response so we can see exactly what PAR returned.
const BASE_URL = process.env.PAR_BASE_URL;
const ACCESS_TOKEN = process.env.PAR_ACCESS_TOKEN;
const storeId = process.argv[2] ?? "28901";
const businessDate = process.argv[3] ?? "2026-07-20";
const token = process.env[`PAR_TOKEN_${storeId}`];

const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetOrders xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate><ExcludeOpenOrders>true</ExcludeOpenOrders></request></GetOrders></soap:Body></soap:Envelope>`;

const res = await fetch(`${BASE_URL}/Sales2.svc`, {
  method: "POST",
  headers: {
    "Content-Type": "text/xml; charset=utf-8",
    "SOAPAction": `"http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders"`,
    "AccessToken": ACCESS_TOKEN,
    "LocationToken": token,
  },
  body,
  signal: AbortSignal.timeout(30_000),
});

console.log("HTTP status:", res.status);
const text = await res.text();
console.log("Response length:", text.length);
console.log(text.slice(0, 3000));
