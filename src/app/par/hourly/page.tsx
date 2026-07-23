import HourlyAuditClient from "@/components/HourlyAuditClient";
import { PAR_LOCATIONS } from "@/lib/par";

export default function HourlyAuditPage() {
  return <HourlyAuditClient locations={PAR_LOCATIONS} />;
}
