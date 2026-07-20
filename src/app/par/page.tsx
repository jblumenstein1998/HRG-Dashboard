import PARClient from "@/components/PARClient";
import { PAR_LOCATIONS } from "@/lib/par";

export default function PARPage() {
  return <PARClient locations={PAR_LOCATIONS} />;
}
